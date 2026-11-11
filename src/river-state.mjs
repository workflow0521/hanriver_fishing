import { kst, parseStamp } from './data.mjs';
import { estimateWaterTurn } from './water-turn.mjs';

const HOUR=3600000, MINUTE=60000;
const CALIBRATION={from:'20260916',through:'20261015',expires:'202611150000',lagMinutes:278.5,windowMinutes:45,minimumHighCm:650,minimumDischarge:133.17,maximumDischarge:338.89};
const finite=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value));
const round=(value,digits=2)=>Number(value.toFixed(digits));
const stamp=time=>kst(new Date(time));
const timeText=time=>`${time.slice(4,6)}/${time.slice(6,8)} ${time.slice(8,10)}:${time.slice(10,12)}`;

function observations(data,now,hours,{nonnegative=false}={}) {
 if(!data||data.demo||data.stale||!Array.isArray(data.rows))return [];
 const rows=new Map();
 for(const row of data.rows){
  const time=String(row?.time??''),at=parseStamp(time);
  if(!Number.isFinite(at)||at<now-hours*HOUR||at>now+MINUTE||!finite(row?.value))continue;
  const value=Number(row.value);
  if(nonnegative?value<0:value<=-90)continue;
  rows.set(time,{time,value});
 }
 const result=[...rows.values()].sort((a,b)=>a.time.localeCompare(b.time));
 const last=result.at(-1);
 return last&&now-parseStamp(last.time)<=HOUR?result:[];
}
function exactChange(rows,minutes){
 const last=rows.at(-1);if(!last)return null;
 const target=stamp(parseStamp(last.time)-minutes*MINUTE),before=rows.find(row=>row.time===target);
 return before?round(last.value-before.value,4):null;
}
function completeHistory(rows,now,hours){
 // A missing observation is never replaced with zero or interpolated.
 if(rows.length<Math.max(2,hours*6-2))return false;
 const first=parseStamp(rows[0].time),last=parseStamp(rows.at(-1).time);
 if(first>now-hours*HOUR+20*MINUTE||last<now-20*MINUTE)return false;
 return rows.every((row,index)=>index===0||parseStamp(row.time)-parseStamp(rows[index-1].time)<=15*MINUTE);
}
function median(values){const sorted=[...values].sort((a,b)=>a-b),i=Math.floor(sorted.length/2);return sorted.length%2?sorted[i]:(sorted[i-1]+sorted[i])/2;}
function tideRows(tides,now){
 const today=stamp(now).slice(0,8);
 if(!tides||tides.demo||tides.stale||tides.day!==today||!Array.isArray(tides.rows))return [];
 const seen=new Map();
 for(const row of tides.rows){const time=String(row?.time??''),at=parseStamp(time);
  if(!Number.isFinite(at)||at<now-36*HOUR||at>now+48*HOUR||!finite(row.height)||!['만조','간조'].includes(row.type))continue;
  seen.set(time,{time,height:Number(row.height),type:row.type});
 }
 return [...seen.values()].sort((a,b)=>a.time.localeCompare(b.time));
}
function unavailable(reason){return {available:false,windowStart:null,windowEnd:null,center:null,label:'고수위 후보 보류',reason};}

/**
 * A display summary of actual gauge observations and separate reference factors.
 * This is not a causal model, a depth estimate, a current-direction forecast,
 * or a continuously recalibrated tide prediction.
 */
export function analyzeRiver(input={},now=Date.now()){
 if(Number.isFinite(input.now))now=Number(input.now);
 if(!Number.isFinite(now))throw new TypeError('유효한 분석 시각이 필요합니다');
 const {zone,water,dam,rain,tides}=input,quick=input.profile==='quick',rangeHours=quick?6:24;
 const waterRows=observations(water,now,rangeHours),damRows=observations(dam,now,6,{nonnegative:true}),rainRows=observations(rain,now,quick?1:24,{nonnegative:true}),coastal=tideRows(tides,now);
 const waterComplete=completeHistory(waterRows,now,rangeHours);
 const last=waterRows.at(-1),damLast=damRows.at(-1),rainLast=rainRows.at(-1);
 const current=last?.value??null,average=waterRows.length>=2?round(waterRows.reduce((sum,row)=>sum+row.value,0)/waterRows.length,4):null;
 const delta10=exactChange(waterRows,10),delta60=exactChange(waterRows,60);
 const values=waterRows.map(row=>row.value),low=values.length?Math.min(...values):null,high=values.length?Math.max(...values):null;
 // A short or incomplete history cannot establish a full-day relative level.
 const range=low===null?null:round(high-low,4),relative=!quick&&waterComplete&&range!==null&&range>=0.03?round(Math.min(1,Math.max(0,(current-low)/range)),4):null;
 let state='unknown',title='수위 추세 확인 중',motion='paused';
 let description=last?'현재 실측 수위는 확인했지만 정확히 1시간 전 비교값이 없어 상승·하강을 판단하지 않습니다.':'최근 1시간 이내의 유효한 수위 관측을 기다립니다.';
 if(delta60!==null){
  if(delta60>=0.02){state='rising';title='수위가 올라가고 있어요';motion='up';description=`직전 1시간 실측 수위가 ${round(delta60*100,1)} cm 상승했습니다.`;}
  else if(delta60<=-0.02){state='falling';title='수위가 내려가고 있어요';motion='down';description=`직전 1시간 실측 수위가 ${round(Math.abs(delta60)*100,1)} cm 하강했습니다.`;}
  else if(relative!==null&&relative>=0.75){state='high_hold';title='최근 범위에서 높은 편이에요';motion='still';description='최근 24시간 실제 관측 범위의 높은 쪽이며, 직전 1시간 변화는 2 cm 미만입니다.';}
  else if(relative!==null&&relative<=0.25){state='low_hold';title='최근 범위에서 낮은 편이에요';motion='still';description='최근 24시간 실제 관측 범위의 낮은 쪽이며, 직전 1시간 변화는 2 cm 미만입니다.';}
  else{state='steady';title='수위 변화가 작아요';motion='still';description='직전 1시간 실측 수위 변화가 2 cm 미만입니다.';}
 }
 if(last)description+=' 관측소 기준 높이이며 낚시터 수심·물돌이 시각을 뜻하지 않습니다.';
 const damComplete=completeHistory(damRows,now,6),rainComplete=!quick&&completeHistory(rainRows,now,24);
 description+=last?' 최근 '+rangeHours+'시간 중 확보한 '+waterRows.length+'건의 실제 관측을 비교합니다.':' 분석 범위는 최근 '+rangeHours+'시간입니다.';
 if(last&&!waterComplete)description+=' 조회 기간 이력이 불완전하며 누락된 관측은 추정하지 않습니다.';
 const recentRain=rainRows.filter(row=>parseStamp(row.time)>=now-HOUR),rainSignal=recentRain.some(row=>row.value>0),rain24Signal=rainRows.some(row=>row.value>0);
 const recentRainComplete=recentRain.length>=5&&parseStamp(recentRain[0].time)<=now-HOUR+15*MINUTE&&parseStamp(recentRain.at(-1).time)>=now-15*MINUTE&&recentRain.every((row,index)=>index===0||parseStamp(row.time)-parseStamp(recentRain[index-1].time)<=15*MINUTE);
 const damDelta=exactChange(damRows,60),damValues=damRows.map(row=>row.value),damSpread=damValues.length?Math.max(...damValues)-Math.min(...damValues):null;
 const damStable=damComplete&&damSpread<=Math.max(25,median(damValues)*0.1);
 const damChange=damDelta!==null&&Math.abs(damDelta)>=Math.max(25,damLast.value*0.1);
 const factors=[
  {id:'tide',label:'인천 조석',value:coastal.length?'공식 고·저조 예보':'자료 확인 중',status:coastal.length?'reference':'missing',detail:coastal.length?'인천 예보를 시각 참고로 사용합니다. 인천 조위와 한강 수위는 기준면이 달라 높이를 직접 비교하지 않습니다.':'오늘 인천 조석 예보를 확인하지 못했습니다.'},
  {id:'dam',label:'팔당 방류',value:damLast?`${round(damLast.value,1)} m³/s`:'자료 확인 중',status:damLast?(damChange?'changed':'reference'):'missing',detail:damLast?`${dam?.station||'팔당댐'} ${timeText(damLast.time)} 관측. ${damDelta===null?'정확히 1시간 전 비교값은 없습니다.':`1시간 전보다 ${damDelta>0?'+':''}${round(damDelta,1)} m³/s.`} ${damComplete?(damStable?'최근 6시간 변동이 분석의 안정 조건 이내입니다.':'최근 6시간 방류 변화가 커 고정 시차 적용을 보류합니다.'):'최근 6시간 이력이 충분하지 않습니다.'} 방류와 수위의 인과적 기여율은 계산하지 않습니다.`:'최근 1시간 이내 팔당댐 방류 관측을 확인하지 못했습니다.'},
  {id:'rain',label:'주변 강수',value:rainLast?(rainSignal?'최근 1시간 강수 신호':recentRainComplete?'최근 1시간 양의 관측 없음':'강수 비교 자료 부족'):'자료 확인 중',status:rainLast?(rainSignal?'changed':recentRainComplete?'reference':'missing'):'missing',detail:rainLast?`${rain?.station||'서울시(송정동)'} ${timeText(rainLast.time)}의 10분 원자료 ${round(rainLast.value,1)} mm. ${recentRainComplete?'최근 1시간 관측 이력을 확인했습니다.':`최근 1시간 관측 ${recentRain.length}건으로 이력이 불완전하여 무강수로 판단하지 않습니다.`} ${quick?'빠른 확인에서는 최근 1시간 강수만 참고하며 24시간 건조 조건을 판단하지 않습니다.':rainComplete?(rain24Signal?'최근 24시간 양의 강수 관측이 있습니다.':'최근 24시간 양의 강수 관측이 없습니다.'):'최근 24시간 강수 이력이 충분하지 않습니다.'} 강수 원자료는 합산하지 않으며, 이 지점이 한강 상류 전체 강수를 대표하지 않습니다.`:'최근 1시간 이내 주변 강수 관측을 확인하지 못했습니다.'}
 ];
 let peak;
 if(quick)peak=unavailable('빠른 확인은 최근 6시간 수위·방류와 1시간 주변 강수를 참고합니다. 조석에 따른 고수위 후보에는 24시간 정밀 자료가 필요합니다.');
 else if(zone!=='ttukseom')peak=unavailable('청담대교에 대해 분석한 시차이므로 다른 구역에 적용하지 않습니다.');
 else if(now>=parseStamp(CALIBRATION.expires))peak=unavailable('2026년 9~10월의 잠정 시차 보정 유효기간이 지나 재분석이 필요합니다.');
 else if(!last||waterRows.length<2)peak=unavailable('최근 실제 수위 관측이 부족합니다.');
 else if(!damLast||!rainLast)peak=unavailable('방류·주변 강수 자료를 함께 확인하지 못했습니다.');
 else if(damLast.value<CALIBRATION.minimumDischarge||damLast.value>CALIBRATION.maximumDischarge)peak=unavailable('현재 팔당 방류량이 시차를 분석했던 133.17~338.89 m³/s 범위 밖입니다.');
 else if(!damComplete||!rainComplete)peak=unavailable('방류 6시간·주변 강수 24시간의 실제 관측 이력이 충분하지 않습니다.');
 else if(!damStable)peak=unavailable('최근 팔당 방류 변화가 커 잠정 고정 시차를 적용하지 않습니다.');
 else if(rain24Signal)peak=unavailable('최근 24시간 주변 강수 신호가 있어 건조 조건의 잠정 시차를 적용하지 않습니다.');
 else if(!coastal.length)peak=unavailable('오늘 인천 고·저조 예보를 확인하지 못했습니다.');
 else {
  const candidates=coastal.filter(row=>row.type==='만조').map(row=>({row,center:Math.round((parseStamp(row.time)+CALIBRATION.lagMinutes*MINUTE)/(5*MINUTE))*5*MINUTE})).filter(item=>item.center+CALIBRATION.windowMinutes*MINUTE>=now&&item.center<now+24*HOUR);
  const candidate=candidates.find(item=>item.row.height>CALIBRATION.minimumHighCm);
  if(!candidate)peak=unavailable(candidates.length?'가까운 인천 만조는 이번 분석에서 반응이 약했던 높이 구간에 있어 시간 환산을 보류합니다.':'현재 시각 이후에 참고할 인천 만조 예보가 없습니다.');
  else{
   const center=stamp(candidate.center),windowStart=stamp(candidate.center-CALIBRATION.windowMinutes*MINUTE),windowEnd=stamp(candidate.center+CALIBRATION.windowMinutes*MINUTE);
   peak={available:true,windowStart,windowEnd,center,label:'청담대교 고수위 후보 시간대',reason:`인천 만조 ${timeText(candidate.row.time)}에 약 4시간 40분을 더한 잠정 참고입니다. 2026년 9월 16일~10월 15일 분석을 사용하며 실시간 재보정값·물돌이 예보가 아닙니다. ±45분은 표시용 여유 구간이며 검증된 신뢰구간이 아닙니다.`};
   factors[0].value=`고수위 후보 ${timeText(windowStart)}~${windowEnd.slice(8,10)}:${windowEnd.slice(10,12)}`;
   factors[0].status='reference';
   factors[0].detail='최근 30일의 청담대교 고수위 시차를 참고했습니다. 현재 상승·하강은 실제 수위로 따로 판단하며, 간조·유속 반전 시각은 환산하지 않습니다.';
  }
 }
 const factorsAvailable=factors.every(factor=>factor.status!=='missing');
 const confidence=delta60===null?{status:'insufficient',label:'실측 이력 부족'}:waterComplete&&factorsAvailable?{status:'observed',label:'실측 추세 확인'}:{status:'partial',label:'일부 자료로 실측 추세 확인'};
 return {version:'river-summary-v1',state,title,description,currentLevelM:current,averageLevelM:average,change10mCm:delta10===null?null:round(delta10*100,2),change1hCm:delta60===null?null:round(delta60*100,2),relativeLevel:relative,waterTime:last?.time??null,rangeHours,sampleCount:waterRows.length,motion,factors,peak,confidence,waterTurn:estimateWaterTurn(water,now)};
}
