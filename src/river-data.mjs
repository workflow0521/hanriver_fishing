import {laggedWaterEnd,delayedWaterSnapshot} from './delayed-water.mjs';
import {fetchJSON,tideData,waterContent,normalWater,zones,kst,parseStamp} from './data.mjs';
import {analyzeRiver} from './river-state.mjs';

const HOUR=3600000,STEP=600000,BUDGET=30000;
const SOURCE_HEADERS={Accept:'application/json','User-Agent':'HanRiverFishing/1.0 (+https://hangang-fishing-pocket.fluffycharm2.chatgpt.site)'};
const stations={dam:{kind:'dam',code:'1017310',id:'dmobscd',field:'tototf',name:'팔당댐',unit:'m3/s',hours:6},rain:{kind:'rainfall',code:'10184140',id:'rfobscd',field:'rf',name:'서울시(송정동)',unit:'mm',hours:24}};
const validNumber=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value));
const failure=(kind,code)=>Object.assign(new Error('하천 관측 조회 실패'),{sourceFailure:kind,...(code?{safeCode:code}:{})});
function safeFailure(error){
 if(error?.sourceFailure)return error.sourceFailure+(error.safeCode?' '+error.safeCode:'');
 const code=String(error?.message||'').match(/^HRFCO (\d{3})\b/);if(code)return 'HRFCO '+code[1];
 if(error?.name==='AbortError'||error?.name==='TimeoutError')return '시간 초과';
 if(error instanceof TypeError)return '연결 실패';
 return '응답 자료 확인 필요';
}

// Do not interpolate gaps or turn missing observations into zero rainfall/discharge.
export function normalRiverRows(content,source,now=Date.now()){
 if(!Array.isArray(content))throw new Error('하천 관측 응답 형식 오류');
 const spec=stations[source];if(!spec)throw new Error('하천 관측 종류 오류');
 if(content.some(row=>String(row?.[spec.id]??'')!==spec.code))throw new Error('하천 관측소 응답 불일치');
 const end=Math.floor(now/STEP)*STEP,start=end-spec.hours*HOUR,byTime=new Map();
 for(const row of content){
  const time=String(row.ymdhm??''),at=parseStamp(time),raw=row[spec.field]??row[spec.field.toUpperCase()];
  if(!Number.isFinite(at)||at<start||at>end||at>now+60000||!validNumber(raw)||Number(raw)<0)continue;
  byTime.set(time,{time,value:Number(raw)});
 }
 const rows=[...byTime.values()].sort((a,b)=>a.time.localeCompare(b.time));
 if(!rows.length)throw new Error('요청 기간 관측 자료 없음');
 return rows;
}

async function boundedJSON(url,{timeoutMs=11000,deadline=Date.now()+BUDGET}={}){
 const remaining=deadline-Date.now();if(remaining<=0)throw failure('조회 예산 초과');
 try{
  // Use the same transport as the existing, verified water endpoint. Never retry a quick source call.
  return await fetchJSON(url,{timeoutMs:Math.min(timeoutMs,remaining),retries:0,headers:SOURCE_HEADERS});
 }catch(error){
  if(error?.name==='AbortError'||error?.name==='TimeoutError')throw failure('시간 초과');
  const http=String(error?.message||'').match(/^API 오류 \(HTTP (\d{3})\)$/);if(http)throw failure('HTTP',http[1]);
  if(error instanceof TypeError)throw failure('연결 실패');
  throw failure('응답 형식 오류');
 }
}

// This queue belongs to one Worker request. Pending I/O is never shared across requests.
export async function runRiverQueue(jobs,{concurrency=1,deadline=Date.now()+BUDGET}={}){
 const results=new Array(jobs.length);let next=0;
 const worker=async()=>{while(next<jobs.length){const index=next++;if(Date.now()>=deadline){results[index]={status:'rejected',reason:failure('조회 예산 초과')};continue;}try{results[index]={status:'fulfilled',value:await jobs[index]()};}catch(reason){results[index]={status:'rejected',reason};}}};
 await Promise.all(Array.from({length:Math.min(concurrency,jobs.length)},worker));return results;
}

async function chunkData(source,zone,cfg,from,to,options){
 if(!cfg.hrfco)throw failure('연결 설정 확인 필요');
 const spec=source==='water'?{kind:'waterlevel',code:zones[zone].code,id:'wlobscd'}:stations[source];
 const json=await boundedJSON(`https://api.hrfco.go.kr/${encodeURIComponent(cfg.hrfco)}/${spec.kind}/list/10M/${spec.code}/${from}/${to}.json`,options);
 const content=waterContent(json);
 if(content.some(row=>String(row?.[spec.id]??'')!==spec.code))throw failure('관측소 응답 불일치');
 const rows=(source==='water'?normalWater(content,Date.now(),24):normalRiverRows(content,source,Date.now())).filter(row=>row.time>=from&&row.time<=to);
 if(!rows.length)throw failure('구간 관측 없음');return rows;
}

function historyComplete(rows,hours,now){
 if(rows.length<hours*6-2)return false;
 if(parseStamp(rows[0].time)>now-hours*HOUR+20*60000||parseStamp(rows.at(-1).time)<now-20*60000)return false;
 return rows.every((row,index)=>index===0||parseStamp(row.time)-parseStamp(rows[index-1].time)<=15*60000);
}
function mergeSource(source,zone,parts,now,end){
 const byTime=new Map(),errors=[];for(const part of parts){if(part.status==='fulfilled')for(const row of part.value)byTime.set(row.time,row);else errors.push(safeFailure(part.reason));}
 const rows=[...byTime.values()].sort((a,b)=>a.time.localeCompare(b.time));if(!rows.length)return {data:null,errors};
 const spec=source==='water'?{name:'서울시('+zones[zone].station+')',code:zones[zone].code,unit:'m',hours:24}:stations[source];
 const data={demo:false,station:spec.name,stationCode:spec.code,unit:spec.unit,hours:spec.hours,requestedFrom:kst(new Date(end-spec.hours*HOUR)),requestedTo:kst(new Date(end)),rows,stale:now-parseStamp(rows.at(-1).time)>HOUR,historyIncomplete:errors.length>0||!historyComplete(rows,spec.hours,now),missingChunks:errors.length,checkedAt:new Date().toISOString(),...(source==='water'?{historyUnavailable:false}:{}),...(source==='rain'?{scope:'서울 송정동 단일 관측소의 10분 강수량 참고값이며, 한강 상류 전체 유역 강수량을 대표하지 않습니다.'}:{})};
 return {data,errors};
}

async function surroundingTides(cfg,options={}){
 const today=kst().slice(0,8),midnight=parseStamp(today+'0000');
 const days=[-1,0,1].map(offset=>kst(new Date(midnight+offset*24*HOUR)).slice(0,8));
 const results=await Promise.allSettled(days.map(day=>tideData(cfg,day,{timeoutMs:options.timeoutMs??8000,retries:0,...(options.forceRefresh?{cache:'no-store'}:{})})));
 const availableDays=[],missingDays=[],byTime=new Map();
 results.forEach((result,index)=>{if(result.status==='fulfilled'){availableDays.push(days[index]);for(const row of result.value.rows)byTime.set(row.time+row.type,row);}else missingDays.push(days[index]);});
 if(!byTime.size)throw failure('인천 조석 조회 실패');
 return {demo:false,station:'인천',stationCode:'DT_0001',unit:'cm',day:today,days:availableDays,missingDays,rows:[...byTime.values()].sort((a,b)=>a.time.localeCompare(b.time)),checkedAt:new Date().toISOString()};
}

const freshWater=(water,now)=>!water?.demo&&!water?.stale&&water?.rows?.length&&Number.isFinite(parseStamp(water.rows.at(-1).time))&&now-parseStamp(water.rows.at(-1).time)>=-60000&&now-parseStamp(water.rows.at(-1).time)<HOUR;
async function historyRiverData(zone,cfg,{delayMinutes=0,forceRefresh=false,timeoutMs=11000,waterSnapshot=null,fallbackWater=null}={}){
 if(!Object.hasOwn(zones,zone))throw new Error('올바른 구역을 선택하세요');
 const now=Date.now(),end=Math.floor(now/STEP)*STEP,deadline=now+BUDGET;
 const options={forceRefresh,timeoutMs:Math.max(10000,Math.min(12000,timeoutMs)),deadline},useSnapshot=!forceRefresh&&freshWater(waterSnapshot,now)&&waterSnapshot.hours===24;
 const slots={water:[],dam:[],rain:[]},jobs=[];
 const add=(source,chunk)=>{const sourceEnd=source==='water'?laggedWaterEnd(now,delayMinutes):end;const to=kst(new Date(sourceEnd-chunk*6*HOUR)),from=kst(new Date(sourceEnd-(chunk+1)*6*HOUR)),index=jobs.length;slots[source].push(index);jobs.push(()=>chunkData(source,zone,cfg,from,to,options));};
 // Get the most recent water and the current discharge before requesting older history.
 if(!useSnapshot)add('water',0);add('dam',0);add('rain',0);
 for(let chunk=1;chunk<4;chunk++){if(!useSnapshot)add('water',chunk);add('rain',chunk);}
 // Keep HRFCO requests serial and finish them before opening the separate tide connections.
 const results=await runRiverQueue(jobs,{concurrency:1,deadline});
 const tideResult=await surroundingTides(cfg,{timeoutMs:8000,forceRefresh}).then(value=>({status:'fulfilled',value}),reason=>({status:'rejected',reason}));
 const inputs={zone},warnings=[],labels={water:'24시간 수위',dam:'팔당댐 방류량',rain:'송정동 강수량'};
 for(const source of ['water','dam','rain']){
  const merged=source==='water'&&useSnapshot?{data:waterSnapshot,errors:[]}:mergeSource(source,zone,slots[source].map(index=>results[index]),Date.now(),end);
  inputs[source]=merged.data;
  if(merged.errors.length){const reasons=[...new Set(merged.errors)].join('·');warnings.push(labels[source]+(merged.data?' 일부 구간':'')+' 조회 실패 ('+reasons+'). '+(merged.data?'확보한 실제 관측만 사용합니다.':'해당 요인은 판단에서 제외합니다.'));}
  else if(merged.data?.historyIncomplete)warnings.push(labels[source]+'의 관측 이력이 부족합니다. 누락 구간을 추정값으로 채우지 않습니다.');
  if(merged.data?.stale)warnings.push(labels[source]+'의 최신 관측이 1시간 이상 지났습니다. 최신 상태로 해석하지 않습니다.');
 }
 inputs.tides=tideResult.status==='fulfilled'?tideResult.value:null;
 if(!inputs.tides)warnings.push('인천 조석을 불러오지 못했습니다. 해당 요인은 판단에서 제외합니다.');
 const freshFallback=freshWater(fallbackWater,Date.now()),fallbackNewer=freshFallback&&(!inputs.water||fallbackWater.rows.at(-1).time>inputs.water.rows.at(-1).time);
 if(freshFallback&&(!freshWater(inputs.water,Date.now())||fallbackNewer)){
  const note=fallbackNewer&&inputs.water?'기관 응답보다 더 최근에 확인한 실제 관측을 유지합니다.':'기관 재조회가 원활하지 않아 1시간 이내 실제 관측을 유지합니다.';
  const actual=new Map();for(const row of [...(inputs.water?.rows||[]),...fallbackWater.rows]){const at=parseStamp(row.time);if(Number.isFinite(at)&&at>=Date.now()-24*HOUR&&at<=Date.now()+60000)actual.set(row.time,row);}
  const rows=[...actual.values()].sort((a,b)=>a.time.localeCompare(b.time));
  inputs.water={...fallbackWater,rows,hours:24,sourceHours:fallbackWater.hours,historyIncomplete:!historyComplete(rows,24,Date.now()),cached:true,connectionWarning:note,refreshAttemptedAt:new Date().toISOString()};warnings.push('수위는 이전에 확인한 더 최근 실제 관측을 포함합니다. 관측 시각을 확인해 주세요.');
 }
 if(inputs.tides?.missingDays.length)warnings.push('인천 조석 '+inputs.tides.missingDays.map(day=>day.slice(4,6)+'/'+day.slice(6)).join('·')+' 자료가 누락되어 해당 시간대 해석이 제한됩니다.');
 const checked=Date.now();return {...inputs,summary:analyzeRiver({...inputs,now:checked},checked),warnings,checkedAt:new Date().toISOString()};
}


function sourceFresh(data,now){
 const last=data?.rows?.at(-1),age=now-parseStamp(last?.time);
 return !data?.demo&&!data?.stale&&Number.isFinite(age)&&age>=-60000&&age<HOUR;
}
function quickSource(source,zone,data,now){
 const hours=source==='rain'?1:6,code=source==='water'?zones[zone].code:stations[source].code;
 if(!sourceFresh(data,now)||data.stationCode&&String(data.stationCode)!==code)return null;
 const rows=data.rows.filter(row=>validNumber(row.value)&&(source==='water'||Number(row.value)>=0)&&Number.isFinite(parseStamp(row.time))&&parseStamp(row.time)>=now-hours*HOUR&&parseStamp(row.time)<=now+60000).map(row=>({time:row.time,value:Number(row.value)}));
 if(!rows.length)return null;
 const end=Math.floor(now/STEP)*STEP;
 return {...data,hours,rows,requestedFrom:source==='water'&&data.delayMinutes?data.requestedFrom:kst(new Date(end-hours*HOUR)),requestedTo:source==='water'&&data.delayMinutes?data.requestedTo:kst(new Date(end)),historyIncomplete:!historyComplete(rows,hours,now)};
}
function todayTide(data,now){
 const day=kst(new Date(now)).slice(0,8);
 if(!data||data.demo||data.stale||data.day!==day||!Array.isArray(data.rows))return null;
 const rows=data.rows.filter(row=>row.time?.slice(0,8)===day&&Number.isFinite(parseStamp(row.time))&&validNumber(row.height)&&['만조','간조'].includes(row.type));
 return rows.length?{...data,rows,days:[day],missingDays:[]}:null;
}
function factorCoverage(data,hours,now){
 const rows=data?.rows||[],from=rows[0]?.time??null,to=rows.at(-1)?.time??null;
 return {requestedHours:hours,from,to,samples:rows.length,actualSpanHours:from&&to?Number(((parseStamp(to)-parseStamp(from))/HOUR).toFixed(3)):null,complete:!!data&&!data.stale&&historyComplete(rows,hours,now)};
}
export function riverMetadata(data,profile=data.profile||'history',now=Date.now()){
 const quick=profile==='quick',waterHours=quick?6:24,rainHours=quick?1:24;
 const coverage={waterHours,rainHours,damHours:6,water:factorCoverage(data.water,waterHours,now),rain:factorCoverage(data.rain,rainHours,now),dam:factorCoverage(data.dam,6,now)};
 return {profile,historyReady:!quick&&coverage.water.complete&&coverage.rain.complete&&coverage.dam.complete,coverage};
}
async function quickRiverData(zone,cfg,{delayMinutes=0,forceRefresh=false,waterSnapshot=null,fallbackWater=null,sourceSnapshots={},fallbackSources={}}={}){
 if(!Object.hasOwn(zones,zone))throw new Error('올바른 구역을 선택하세요');
 const started=Date.now(),deadline=started+(delayMinutes?13500:10000),inputs={zone,profile:'quick'},warnings=[];
 const labels={water:'6시간 수위',dam:'팔당댐 방류량',rain:'최근 1시간 강수',tides:'오늘 인천 조석'};
 const snapshots={...sourceSnapshots,...(waterSnapshot?{water:waterSnapshot}:{})},fallbacks={...fallbackSources,...(fallbackWater?{water:fallbackWater}:{})};
 const normalize=(source,data)=>source==='tides'?todayTide(data,Date.now()):quickSource(source,zone,data,Date.now());
 // One request at a time, sharing a total10second budget. No background promise outlives this response.
 for(const source of ['water','dam','rain','tides']){
  const prior=normalize(source,fallbacks[source]||snapshots[source]);
  const snapshot=(!forceRefresh||delayMinutes&&source==='water')?normalize(source,snapshots[source]):null;
  if(snapshot){inputs[source]={...snapshot,cached:true};continue;}
  try{
   const remaining=deadline-Date.now();if(remaining<=0)throw failure('조회 예산 초과');
   const timeoutMs=Math.min(delayMinutes&&source==='water'?6000:2500,remaining);
   if(source==='tides'){
    const day=kst().slice(0,8),data=await tideData(cfg,day,{timeoutMs,retries:0});
    inputs[source]={...data,station:'인천',stationCode:'DT_0001',unit:'cm',days:[day],missingDays:[],checkedAt:new Date(Date.now()).toISOString()};
   }else{
    const hours=source==='rain'?1:6,end=source==='water'?laggedWaterEnd(Date.now(),delayMinutes):Math.floor(Date.now()/STEP)*STEP,from=kst(new Date(end-hours*HOUR)),to=kst(new Date(end));
    const actual=await chunkData(source,zone,cfg,from,to,{timeoutMs,deadline});
    const rows=actual.filter(row=>parseStamp(row.time)>=Date.now()-hours*HOUR);if(!rows.length)throw failure('구간 관측 없음');
    const spec=source==='water'?{name:'서울시('+zones[zone].station+')',code:zones[zone].code,unit:'m'}:stations[source];
    const data={demo:false,station:spec.name,stationCode:spec.code,unit:spec.unit,hours,requestedFrom:from,requestedTo:to,rows,stale:Date.now()-parseStamp(rows.at(-1).time)>HOUR,historyIncomplete:!historyComplete(rows,hours,Date.now()),checkedAt:new Date(Date.now()).toISOString(),...(source==='water'?{historyUnavailable:false,delayMinutes}:{}),...(source==='rain'?{scope:'송정동 단일 관측소의 최근1시간 10분 강수 원자료이며 한강 상류 전체 강수를 대표하지 않습니다.'}:{})};
    const oldLast=prior?.rows.at(-1)?.time,newLast=data.rows.at(-1)?.time;
    inputs[source]=prior&&oldLast>newLast?{...prior,cached:true,connectionWarning:'기관 응답보다 최근에 확인한 실제 관측을 유지합니다.'}:data;
   }
   if(inputs[source]?.stale)warnings.push(labels[source]+'의 최신 관측이 1시간 이상 지났습니다. 최신 상태로 해석하지 않습니다.');
   if(inputs[source]?.historyIncomplete)warnings.push(labels[source]+'은 확보한 실제 관측만 사용하며 누락 구간을 채우지 않습니다.');
  }catch(error){
   inputs[source]=prior?{...prior,cached:true,connectionWarning:'기관 재조회가 원활하지 않아 유효한 이전 실제 자료를 유지합니다.',refreshAttemptedAt:new Date(Date.now()).toISOString()}:null;
   warnings.push(labels[source]+' 조회 실패 ('+safeFailure(error)+'). '+(prior?'이전 관측 시각의 실제 자료를 유지합니다.':'해당 요인은 판단에서 제외합니다.'));
  }
 }
 const now=Date.now(),data={...inputs,warnings,checkedAt:new Date(now).toISOString()};
 return {...data,...riverMetadata(data,'quick',now),summary:analyzeRiver({...inputs,now},now)};
}
export async function riverData(zone,cfg,options={}){
 const quick=options.mode==='quick'||options.profile==='quick';
 let data=quick?await quickRiverData(zone,cfg,options):await historyRiverData(zone,cfg,options);
 if(options.delayMinutes){data={...data,water:delayedWaterSnapshot(data.water)};data.summary=analyzeRiver({...data,now:Date.now()},Date.now());}
 return {...data,...riverMetadata(data,quick?'quick':'history')};
}

// The Pages collector shares a single official gauge request across all districts.
export async function publicRiverFactor(source,cfg,hours){
 const spec=stations[source];
 if(!spec||!Number.isInteger(hours)||hours<1||hours>spec.hours)throw Error('관측 범위 오류');
 const end=Math.floor(Date.now()/STEP)*STEP;
 const from=kst(new Date(end-hours*HOUR)),to=kst(new Date(end));
 const rows=await chunkData(source,'ttukseom',cfg,from,to,{timeoutMs:9000});
 return {station:spec.name,stationCode:spec.code,unit:spec.unit,hours,rows,checkedAt:new Date().toISOString()};
}
