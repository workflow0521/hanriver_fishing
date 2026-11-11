import {kst, parseStamp, zones} from './data.mjs';
import {laggedWaterEnd} from './delayed-water.mjs';

// The public 10-minute observation tables used by the Flood Control Office website.
const BASE='https://www.hrfco.go.kr';
const HOUR=3600000;
const factors={
 dam:{path:'/servlet/dm/dmPopupData.do',id:'dmobscd',code:'1017310',value:'tdqty',station:'팔당댐',unit:'m3/s',hours:6},
 rain:{path:'/servlet/rf/rfPopupData.do',id:'rfobscd',code:'10184140',value:'rf',station:'서울시(송정동)',unit:'mm',hours:24},
};

export function publicTableRows(input,{id,code,value},from,to){
 if(!Array.isArray(input)||!input.length||input.some(row=>String(row?.[id])!==code))throw Error('관측소 응답 불일치');
 const byTime=new Map();
 for(const row of input){
  const time=String(row.ymdhm||'').replace(/[- :]/g,''),at=parseStamp(time),raw=row[value];
  if(!Number.isFinite(at)||at<from||at>to||at%600000!==0||raw==null||String(raw).trim()==='')continue;
  const number=Number(raw);
  if(!Number.isFinite(number)||(value==='wl'?number<=-90:number<0))continue;
  byTime.set(time,{time,value:number});
 }
 const rows=[...byTime.values()].sort((a,b)=>a.time.localeCompare(b.time));
 if(!rows.length)throw Error('유효 관측 없음');
 return rows;
}

export async function publicHydrology(source,zone='',hours=6,now=Date.now()){
 const water=source==='water';
 const gauge=water&&Object.hasOwn(zones,zone)?zones[zone]:null;
 const spec=gauge?{path:'/servlet/wlPopupTableData.do',id:'wlobscd',code:gauge.code,value:'wl',station:'서울시('+gauge.station+')',unit:'m'}:factors[source];
 if(!spec||!Number.isInteger(hours)||hours<1||hours>(water?72:spec.hours))throw Error('관측 범위 오류');
 const end=laggedWaterEnd(now,water?15:0),from=end-hours*HOUR;
 const params=new URLSearchParams({[spec.id]:spec.code,sdt:kst(new Date(from)),edt:kst(new Date(end)),[water?'type':'dateType']:'10M'});
 const url=new URL(spec.path,BASE),options={method:water?'POST':'GET',headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(8500)};
 if(water)options.body=params;else url.search=params;
 const result=await fetch(url,options);
 if(!result.ok)throw Error('공개 수문자료 응답 오류');
 const data=await result.json();
 if(water&&String(data.info?.wlobscd)!==spec.code)throw Error('공개 수위 관측소 불일치');
 const rows=publicTableRows(water?data.tableData:data,spec,from,end);
 return {demo:false,station:spec.station,stationCode:spec.code,unit:spec.unit,hours,rows,
  requestedFrom:kst(new Date(from)),requestedTo:kst(new Date(end)),
  checkedAt:new Date().toISOString(),source:'한강홍수통제소 공개 수문자료'};
}
