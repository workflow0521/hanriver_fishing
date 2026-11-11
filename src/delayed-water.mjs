/** All cutoffs use real observation time; retrieval never renews an observation. */
export function laggedWaterEnd(now=Date.now(),minutes=15){return Math.floor((now-minutes*60000)/600000)*600000;}

export function delayedWaterSnapshot(water,now=Date.now()){
 const minute=60000,hour=3600000,end=Math.floor((now-15*minute)/(10*minute))*10*minute;
 const stamp=ms=>new Date(ms+9*hour).toISOString().slice(0,16).replace(/[-T:]/g,'');
 const parse=s=>{if(!/^\d{12}$/.test(String(s)))return NaN;const ms=Date.parse(s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8)+'T'+s.slice(8,10)+':'+s.slice(10,12)+':00+09:00');return Number.isFinite(ms)&&stamp(ms)===s?ms:NaN;};
 if(!Number.isFinite(now)||!water||water.demo||!Array.isArray(water.rows))return null;
 const hours=[6,24,72].includes(water.hours)?water.hours:6,byTime=new Map();
 for(const row of water.rows){const at=parse(row?.time);if(!Number.isFinite(at)||at>end||at<end-(hours+24)*hour||typeof row.value!=='number'||!Number.isFinite(row.value)||row.value<=-90)continue;byTime.set(row.time,{time:row.time,value:row.value});}
 const all=[...byTime.values()].sort((a,b)=>a.time.localeCompare(b.time));if(!all.length)return null;const lastAt=parse(all.at(-1).time),rows=all.filter(row=>parse(row.time)>=lastAt-hours*hour);
 const age=now-parse(rows.at(-1).time);
 return {...water,hours,rows,delayMinutes:15,cutoffTime:stamp(end),stale:age>=hour,observationAgeMinutes:Math.floor(age/minute)};
}
