import {mkdir, writeFile} from 'node:fs/promises';
import {zones, parseStamp, waterData, weatherData, tideWindowData} from '../src/data.mjs';
import {publicRiverFactor} from '../src/river-data.mjs';
import {snapshotWater, selectPublicData} from '../src/public-data.mjs';
import {generateAdvice} from '../src/advice.mjs';

const PUBLIC_SITE='https://workflow0521.github.io/hanriver_fishing/';
const repo=process.env.GITHUB_REPOSITORY;
const config={mode:'live',kma:process.env.PUBLIC_DATA_API_KEY||'',tide:process.env.PUBLIC_DATA_API_KEY||'',
 waterSource:'hrfco',hrfco:process.env.HRFCO_API_KEY||''};
const gemini=process.env.GEMINI_API_KEY||'';
const now=Date.now(),hour=3600000;
const checked=()=>new Date().toISOString();

async function readPrevious(){
 try{
  const url=new URL('data/snapshot.json?v='+now,PUBLIC_SITE);
  const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(6000),redirect:'error'});
  if(!response.ok)return {};
  const text=await response.text();
  if(text.length>1_500_000)return {};
  const result=JSON.parse(text);
  return result.schema===1?result:{};
 }catch{return {};}
}

function warning(error){
 const code=/^HRFCO (\d{3})\b/.exec(String(error?.message));
 if(code)return 'HRFCO '+code[1];
 if(error?.name==='TimeoutError'||error?.name==='AbortError')return '시간 초과';
 return '조회 실패';
}

const previous=repo==='workflow0521/hanriver_fishing'?await readPrevious():{};
const statuses={};
async function attempt(name,key,request){
 if(!key){statuses[name]='연결 설정 대기';return null;}
 try{const value=await request();statuses[name]='확보';return value;}
 catch(error){statuses[name]=warning(error);return null;}
}

async function collectWater(zone){
 const prior=snapshotWater(previous.water?.[zone],72,now);
 const opts={delayMinutes:15,timeoutMs:9000,retries:0};
 const name='water-'+zone;
 let fresh=await attempt(name,config.hrfco,()=>waterData(zone,config,{...opts,hours:prior?6:72}));
 if(!prior&&!fresh&&config.hrfco&&!/^HRFCO 9[04][0-4]$/.test(statuses[name]))
  fresh=await attempt(name,config.hrfco,()=>waterData(zone,config,{...opts,hours:6}));
 if(!fresh&&!prior)return null;
 const byTime=new Map();
 for(const row of [...(prior?.rows||[]),...(fresh?.rows||[])])byTime.set(row.time,row);
 const newest=fresh&&(!prior||fresh.rows.at(-1).time>=prior.rows.at(-1).time);
 const basis=newest?{...fresh,checkedAt:checked()}:prior;
 return snapshotWater({...basis,rows:[...byTime.values()],...(!newest?{cached:true,connectionWarning:'갱신 지연 · 마지막 실제 관측을 유지합니다.'}:{})},72,Date.now());
}

function oldFresh(value,maximum,field){
 const at=parseStamp(field(value)),age=Date.now()-at;
 return value&&!value.demo&&Number.isFinite(age)&&age>=-60000&&age<maximum?value:null;
}

const water={},weather={};
const waterTask=(async()=>{for(const zone of Object.keys(zones))water[zone]=await collectWater(zone);})();
const weatherTask=Promise.all(Object.keys(zones).map(async zone=>{
 const value=await attempt('weather-'+zone,config.kma,()=>weatherData(zone,config));
 const prior=oldFresh(previous.weather?.[zone],2*hour,data=>data?.time);
 weather[zone]=value&&(!prior||value.time>=prior.time)?{...value,checkedAt:checked()}:prior;
}));
const tideTask=attempt('tides',config.tide,()=>tideWindowData(config));
await Promise.all([waterTask,weatherTask]);
const dam=await attempt('dam',config.hrfco,()=>publicRiverFactor('dam',config,6));
const rain=await attempt('rain',config.hrfco,()=>publicRiverFactor('rain',config,24));
const tides=await tideTask;
const payload={
 schema:1,collectedAt:checked(),water,weather,
 tides:tides||previous.tides||null,
 dam:dam||oldFresh(previous.dam,hour,data=>data?.rows?.at(-1)?.time),
 rain:rain||oldFresh(previous.rain,hour,data=>data?.rows?.at(-1)?.time),
 advice:{},statuses,
};
for(const zone of Object.keys(zones)){
 try{payload.advice[zone]=selectPublicData(previous,'advice',zone);}catch{}
}
if(process.env.PUBLISH_ADVICE==='true'&&gemini){
 const observations={};
 for(const zone of Object.keys(zones)){
  const prior=payload.advice[zone];
  if(prior&&Date.now()-Date.parse(prior.generatedAt)<hour)continue;
  const river=selectPublicData(payload,'river',zone);
  observations[zone]={water:river.water,tides:river.tides,weather:weather[zone]};
 }
 if(Object.keys(observations).length){
  const advice=await attempt('advice',gemini,()=>generateAdvice(observations,gemini,process.env.GEMINI_MODEL||undefined));
  if(advice)Object.assign(payload.advice,advice);
 }
}

const serialized=JSON.stringify(payload);
const sensitive=[config.kma,config.hrfco,gemini].filter(key=>key.length>=12);
if(sensitive.some(key=>serialized.includes(key)||serialized.includes(encodeURIComponent(key))))throw Error('Public snapshot blocked by credential check');
const output=new URL('../site/data/',import.meta.url);
await mkdir(output,{recursive:true});
await writeFile(new URL('snapshot.json',output),serialized);
console.log('Public collection: '+JSON.stringify(statuses));
