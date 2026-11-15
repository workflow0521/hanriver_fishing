import {parseStamp, zones} from './data.mjs';
import {laggedWaterEnd} from './delayed-water.mjs';

const HOUR=3600000;
const MAX_HANDOFF_AGE=40*60000;
const origin='한강홍수통제소 공개 수문자료';
const gauges=Object.fromEntries(Object.entries(zones).map(([zone,gauge])=>[zone,{station:'서울시('+gauge.station+')',code:gauge.code,unit:'m',hours:72}]));
const factors={dam:{station:'팔당댐',code:'1017310',unit:'m3/s',hours:6},rain:{station:'서울시(송정동)',code:'10184140',unit:'mm',hours:24}};

function sanitize(value,spec,cutoff,now){
 if(!value||value.demo||value.source!==origin||value.stationCode!==spec.code||value.unit!==spec.unit||!Array.isArray(value.rows)||value.rows.length>spec.hours*6+1)return null;
 const checked=Date.parse(value.checkedAt),min=cutoff-spec.hours*HOUR,rows=new Map();
 if(!Number.isFinite(checked)||checked>now+60000||now-checked>MAX_HANDOFF_AGE)return null;
 for(const entry of value.rows){
  const at=parseStamp(entry?.time),number=entry?.value;
  if(!Number.isFinite(at)||at%600000!==0||at<min||at>cutoff||!Number.isFinite(number)||(spec.unit==='m'?number<=-90:number<0))continue;
  rows.set(entry.time,{time:entry.time,value:number});
 }
 const actual=[...rows.values()].sort((a,b)=>a.time.localeCompare(b.time));
 if(!actual.length||now-parseStamp(actual.at(-1).time)>MAX_HANDOFF_AGE)return null;
 return {demo:false,station:spec.station,stationCode:spec.code,unit:spec.unit,hours:spec.hours,rows:actual,source:origin,checkedAt:new Date(checked).toISOString()};
}

export function validateHydrologyHandoff(input,now=Date.now()){
 const empty={water:{},dam:null,rain:null};
 const at=Date.parse(input?.collectedAt);
 if(input?.schema!==1||!Number.isFinite(at)||at>now+60000||now-at>MAX_HANDOFF_AGE)return empty;
 const water={};
 for(const [zone,spec] of Object.entries(gauges)){
  const valid=sanitize(input.water?.[zone],spec,laggedWaterEnd(now),now);
  if(valid)water[zone]=valid;
 }
 const cutoff=laggedWaterEnd(now,0);
 return {water,dam:sanitize(input.dam,factors.dam,cutoff,now),rain:sanitize(input.rain,factors.rain,cutoff,now)};
}
