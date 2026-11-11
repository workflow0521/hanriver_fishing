/** Experimental gauge-stage turning estimate. Never a tidal-current forecast.
 * Only the seven ten-minute observations ending at the newest gauge sample
 * enter the fit. Tide offsets, future samples and selected chart periods do not.
 */
export function estimateWaterTurn(water,now=Date.now()){
 const minute=60000,step=10*minute;
 const stamp=ms=>new Date(ms+9*60*minute).toISOString().slice(0,16).replace(/[-T:]/g,'');
 const parse=value=>{const s=String(value??'');if(!/^\d{12}$/.test(s))return NaN;const ms=Date.parse(s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8)+'T'+s.slice(8,10)+':'+s.slice(10,12)+':00+09:00');return Number.isFinite(ms)&&stamp(ms)===s?ms:NaN;};
 const numeric=value=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value));
 const round=(value,n=2)=>Number(value.toFixed(n));
 const out={version:'stage-turn-1h-v1',kind:'gauge-stage-turn',basisMinutes:60,horizonMinutes:60,currentReversalVerified:false,status:'insufficient',anchorTime:null,from:null,through:null,sampleCount:0,averageLevelM:null,change1hCm:null,trend:'unknown',event:null,reason:'직전 1시간의 10분 관측 7개가 필요합니다.'};
 if(!Number.isFinite(now)||!water||water.demo||water.stale||!Array.isArray(water.rows))return out;
 const map=new Map();for(const row of water.rows){const at=parse(row?.time);if(!Number.isFinite(at)||at>now+minute||at<now-2*60*minute||!numeric(row?.value)||Number(row.value)<=-90)continue;map.set(at,{time:String(row.time),at,value:Number(row.value)});}
 const valid=[...map.values()].sort((a,b)=>a.at-b.at),last=valid.at(-1);if(!last)return out;
 const rows=valid.filter(row=>row.at>=last.at-60*minute);
 Object.assign(out,{anchorTime:last.time,from:rows[0]?.time||null,through:last.time,sampleCount:rows.length,averageLevelM:rows.length>=2?round(rows.reduce((sum,row)=>sum+row.value,0)/rows.length,4):null});
 if(now-last.at>=25*minute)return {...out,status:'stale',reason:'최신 관측이 25분 이상 지연되어 단기 추정을 멈춥니다.'};
 if(rows.length!==7||rows.some((row,i)=>i&&row.at-rows[i-1].at!==step))return out;
 const values=rows.map(row=>row.value*100),span=Math.max(...values)-Math.min(...values),delta=values[6]-values[0];
 Object.assign(out,{averageLevelM:round(values.reduce((a,b)=>a+b,0)/700,4),change1hCm:round(delta),trend:delta>=2?'rising':delta<=-2?'falling':'steady'});
 if(rows.some((row,i)=>i&&Math.abs(values[i]-values[i-1])>20))return {...out,status:'unstable',reason:'급격한 수위 변화가 있어 단기 곡선 추정을 보류합니다.'};
 if(span<2)return {...out,status:'steady',reason:'직전 1시간의 수위 변동이 2 cm 미만인 정체 구간입니다.'};
 // A reversal already present in the last hour is observed, not predicted.
 // Require >=2cm on both sides; plateaus get an observed interval, not a point.
 let observed;
 for(let i=2;i<=4;i++){
  const before=values.slice(0,i+1),after=values.slice(i),level=values[i];
  const peak=level-Math.min(...before)>=2&&level-Math.min(...after)>=2&&level>=Math.max(...before)-0.1&&level>=Math.max(...after)-0.1;
  const low=Math.max(...before)-level>=2&&Math.max(...after)-level>=2&&level<=Math.min(...before)+0.1&&level<=Math.min(...after)+0.1;
  if(!peak&&!low)continue;
  const plateau=rows.filter((row,j)=>Math.abs(values[j]-level)<0.1);
  observed={type:peak?'peak':'trough',center:rows[i].time,windowStart:plateau[0].time,windowEnd:plateau.at(-1).time,observed:true};
 }
 if(observed)return {...out,status:'observed',event:observed,reason:'직전 1시간 안에서 수위 방향 전환을 관측했습니다. 유속 반전 확인은 아닙니다.'};
 const fit=points=>{
  const n=points.length,mid=(n-1)/2,mean=points.reduce((a,b)=>a+b,0)/n,x=points.map((_,i)=>i-mid),s2=x.reduce((s,v)=>s+v*v,0),q=x.map(v=>v*v-s2/n),b=x.reduce((s,v,i)=>s+v*(points[i]-mean),0)/s2,c=q.reduce((s,v,i)=>s+v*(points[i]-mean),0)/q.reduce((s,v)=>s+v*v,0);
  const residual=Math.sqrt(points.reduce((s,v,i)=>s+(v-(mean+b*x[i]+c*q[i]))**2,0)/n),speed=b+2*c*mid,eta=Math.abs(c)>1e-9?-speed/(2*c)*10:Infinity;
  return {residual,speed,acceleration:2*c,eta};
 };
 const fitted=fit(values),tail6=fit(values.slice(1)),tail5=fit(values.slice(2));
 const recent=(values[6]-values[4])/2,previous=(values[4]-values[2])/2,direction=Math.sign(fitted.speed);
 const stable=fitted.residual<=0.75&&tail6.residual<=0.75&&tail5.residual<=0.75;
 const slowing=Math.abs(fitted.speed)>=0.1&&Math.abs(fitted.acceleration)>=0.04&&fitted.speed*fitted.acceleration<0&&recent*direction>=0&&previous*direction>0&&Math.abs(previous)-Math.abs(recent)>=0.25;
 const fits=[fitted,tail6,tail5],consistent=fits.every(f=>Number.isFinite(f.eta)&&f.eta>0&&f.eta<=60&&Math.sign(f.speed)===direction)&&Math.max(...fits.map(f=>f.eta))-Math.min(...fits.map(f=>f.eta))<=20;
 if(!stable)return {...out,status:'unstable',reason:'최근 1시간 수위 변동이 불규칙해 전환 시각을 보류합니다.'};
 if(!slowing||!consistent)return {...out,status:'no_turn',reason:'직전 1시간 수위에서 다음 1시간 내 전환을 뒷받침하는 감속 신호가 없습니다.'};
 const eta=fits.map(f=>f.eta).sort((a,b)=>a-b)[1],center=Math.round((last.at+eta*minute)/step)*step;
 // Display resolution, not a calibrated statistical confidence interval.
 const start=Math.floor((center-20*minute)/step)*step,end=Math.ceil((center+20*minute)/step)*step;
 if(end<=now||center<now-10*minute)return {...out,status:'no_turn',reason:'관측 지연으로 추정 전환 구간이 지났습니다. 새 관측을 기다립니다.'};
 return {...out,status:'predicted',event:{type:fitted.acceleration<0?'peak':'trough',center:stamp(center),windowStart:stamp(Math.max(last.at,start)),windowEnd:stamp(Math.min(last.at+60*minute,end)),observed:false,displayMarginMinutes:20},reason:'최근 1시간 수위의 감속 곡선을 연장한 실험 추정입니다. 표시 여유 ±20분은 검증된 오차범위가 아니며, 실제 물돌이 시각은 확인되지 않았습니다.'};
}
