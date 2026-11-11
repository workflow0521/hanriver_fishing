import {kst, parseStamp, zones} from './data.mjs';
import {delayedWaterSnapshot} from './delayed-water.mjs';
import {analyzeRiver} from './river-state.mjs';
import {riverMetadata} from './river-data.mjs';

const HOUR=3600000, MINUTE=60000;
const recent=(time,now,maximum)=>{const age=now-parseStamp(time);return Number.isFinite(age)&&age>=-MINUTE&&age<maximum;};
let inflight,last;

async function loadSnapshot(force){
 const now=Date.now();
 if(inflight)return inflight;
 if(!force&&last&&now-last.at<25000)return last.data;
 inflight=(async()=>{
  const url=new URL('../data/snapshot.json',import.meta.url);
  url.searchParams.set('v',String(Math.floor(now/MINUTE)));
  const response=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('공개 자료를 아직 게시하지 못했습니다.');
  const data=await response.json();
  if(data.schema!==1)throw Error('공개 자료 형식을 확인할 수 없습니다.');
  last={at:now,data};
  return data;
 })();
 try{return await inflight;}finally{inflight=null;}
}

export function snapshotWater(raw,hours=6,now=Date.now()){
 if(![6,24,72].includes(hours))return null;
 const result=delayedWaterSnapshot(raw&&{...raw,hours},now);
 if(!result||!recent(result.rows.at(-1).time,now,24*HOUR))return null;
 const from=parseStamp(result.rows.at(-1).time)-hours*HOUR;
 return {...result,requestedFrom:kst(new Date(from)),requestedTo:result.rows.at(-1).time};
}

function usableTides(tides,now){
 const day=kst(new Date(now)).slice(0,8);
 if(!tides||tides.demo)return null;
 const rows=(tides.nearbyRows||tides.rows||[]).filter(row=>row.time?.slice(0,8)===day);
 return rows.length?{...tides,day,rows}:null;
}

function factor(value,hours,now){
 const rows=(value?.rows||[]).filter(row=>Number.isFinite(row.value)&&recent(row.time,now,hours*HOUR));
 return rows.length&&recent(rows.at(-1).time,now,HOUR)?{...value,hours,rows,stale:false}:null;
}

export function selectPublicData(data,kind,zone='',{hours=6,mode='quick'}={},now=Date.now()){
 if(kind!=='tides'&&!Object.hasOwn(zones,zone))throw Error('구역을 확인해 주세요.');
 const tides=usableTides(data.tides,now),w=data.weather?.[zone];
 const weather=!w?.demo&&recent(w?.time,now,2*HOUR)?w:null;
 const water=snapshotWater(data.water?.[zone],kind==='water'?hours:mode==='history'?24:6,now);
 const unavailable='공개 관측 자료 갱신 대기 · 잠시 후 다시 확인해 주세요.';
 if(kind==='water'){if(water)return water;throw Error(unavailable);}
 if(kind==='weather'){if(weather)return weather;throw Error(unavailable);}
 if(kind==='tides'){if(tides)return tides;throw Error('오늘 인천 조석 예보 갱신 대기');}
 if(kind==='river'){
  const profile=mode==='history'?'history':'quick';
  const rain=factor(data.rain,profile==='history'?24:1,now),dam=factor(data.dam,6,now);
  const inputs={zone,profile,water,tides,dam,rain,checkedAt:data.collectedAt,
   warnings:[!water&&'공개 수위 자료 갱신 대기',!tides&&'오늘 인천 조석 갱신 대기',!dam&&'팔당 방류 관측 갱신 대기',!rain&&'송정동 강수 관측 갱신 대기'].filter(Boolean)};
  return {...inputs,...riverMetadata(inputs,profile,now),summary:analyzeRiver(inputs,now)};
 }
 if(kind==='advice'){
  const entry=data.advice?.[zone],age=now-Date.parse(entry?.generatedAt);
  if(entry&&age>=0&&age<2*HOUR&&(!entry.tideDay||entry.tideDay===tides?.day))return entry;
  throw Error('최근 게시된 공개 AI 조언이 없습니다. 수위·날씨 자료는 별도로 확인할 수 있습니다.');
 }
 throw Error('공개 자료 종류를 확인해 주세요.');
}

export async function publicData(kind,zone,options={}){
 return selectPublicData(await loadSnapshot(options.force),kind,zone,options);
}
