import {laggedWaterEnd} from './delayed-water.mjs';
const zones = {
  ttukseom: { name:'뚝섬', station:'청담대교', code:'1018662', nx:62, ny:126 },
  yanghwa: { name:'양화/선유도', station:'한강대교', code:'1018683', nx:58, ny:126 },
  mangwon: { name:'망원', station:'행주대교', code:'1019630', nx:58, ny:127 },
  banpo: { name:'반포', station:'잠수교', code:'1018680', nx:60, ny:125 }
};

function kst(date=new Date()) { return new Date(date.getTime()+9*3600000).toISOString().slice(0,16).replace(/[-T:]/g,''); }

function parseStamp(s) {
  if(!/^\d{12}$/.test(s)) return NaN;
  const date = new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:00+09:00`);
  return Number.isFinite(+date) && kst(date)===s ? +date : NaN;
}

function numeric(v) { return v!==null && v!==undefined && String(v).trim()!=='' && Number.isFinite(Number(v)); }

function decodeKey(key) { try { return decodeURIComponent(key.trim()); } catch { return key.trim(); } }

function reason(e) {
  if(e.name==='AbortError') return '응답 시간 초과';
  if(e instanceof TypeError) return '연결 실패 · 네트워크 또는 브라우저 접근 제한(CORS)을 확인하세요';
  return e.message || '데이터 조회 실패';
}

async function fetchJSONOnce(url, options={}) {
  const controller=new AbortController();
  const {timeoutMs=15000,retries=1,...fetchOptions}=options;
  const timeout=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const r=await fetch(url,{...fetchOptions,headers:{Accept:'application/json',...fetchOptions.headers},signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
    if(!r.ok) { await r.body?.cancel(); throw new Error(`API 오류 (HTTP ${r.status})`); }
    try { return await r.json(); } catch { throw new Error('JSON 응답이 아닙니다 · 인증키와 서비스 승인을 확인하세요'); }
  } finally { clearTimeout(timeout); }
}

async function fetchJSON(url,options={}) {
 try{return await fetchJSONOnce(url,options);}catch(error){
  if(options.retries===0||error?.name!=='AbortError'&&!(error instanceof TypeError)&&!/HTTP (502|503|504)/.test(error?.message||''))throw error;
  return fetchJSONOnce(url,options);
 }
}

function normalWater(rows, now=Date.now(),hours=6) {
  if(!Array.isArray(rows)) throw new Error('수위 응답 형식 오류');
  const byTime=new Map();
  for(const row of rows) {
    const s=String(row.ymdhm??''); const t=parseStamp(s);
    if(Number.isFinite(t) && t<=now+60000 && t>=now-hours*3600000 && numeric(row.wl) && Number(row.wl)>-90) byTime.set(s,{time:s,value:Number(row.wl)});
  }
  const out=[...byTime.values()].sort((a,b)=>a.time.localeCompare(b.time));
  if(!out.length) throw new Error('요청 기간에 유효한 수위 관측값이 없습니다');
  return out;
}

function waterContent(json) {
  const code=String(json?.code??'');
  if(code && code!=='200') {
    const messages={900:'인증키 확인 필요',940:'등록한 사용 URL(DNS, IP) 확인 필요',941:'이메일 승인 대기',942:'인증키 차단 · 기관 문의 필요',943:'휴면 인증키 · 휴면 해제 필요',944:'삭제된 인증키',990:'조회 자료 없음'};
    const safeCode=/^\d{3}$/.test(code)?code:'형식 오류';
    throw new Error(`HRFCO ${safeCode} · ${messages[code]||'자료 조회 실패'}`);
  }
  if(!Array.isArray(json?.content)) throw new Error('HRFCO 응답 형식 오류');
  return json.content;
}

async function waterData(zone,cfg,options={}) {
  if(cfg.waterSource!=='hrfco') throw new Error('신청한 수위 서비스 승인·연결 대기 · 기상청 날씨는 별도로 조회됩니다');
  if(!cfg.hrfco) throw new Error('HRFCO 인증키 미입력');
  const base=`https://api.hrfco.go.kr/${encodeURIComponent(cfg.hrfco)}/waterlevel`;
  // Codes and exact station names verified against official HRFCO metadata.
  const station={wlobscd:zones[zone].code,obsnm:'서울시('+zones[zone].station+')'};
  const {hours=6,delayMinutes=0,...fetchOptions}=options;
  if(![6,24,72].includes(hours))throw new Error('조회 기간은 6·24·72시간 중 선택하세요');
  const endTime=laggedWaterEnd(Date.now(),delayMinutes);
  const end=kst(new Date(endTime)), start=kst(new Date(endTime-hours*3600000));
  const opts={...fetchOptions,headers:{'User-Agent':'HanRiverFishing/1.0 (+https://hangang-fishing-pocket.fluffycharm2.chatgpt.site)',...fetchOptions.headers}};
  let json,historyUnavailable=false;
  try{json=await fetchJSON(`${base}/list/10M/${station.wlobscd}/${start}/${end}.json`,opts);}
  catch(error){
   if(error?.name!=='AbortError'&&error?.name!=='TimeoutError'&&!(error instanceof TypeError)&&!/HTTP (502|503|504)/.test(error?.message||''))throw error;
   json=await fetchJSON(`${base}/list/10M/${station.wlobscd}.json`,{...opts,retries:0});historyUnavailable=true;
  }
  const content=waterContent(json);
  if(content.some(row=>String(row.wlobscd)!==String(station.wlobscd)))throw new Error('HRFCO 요청 관측소와 응답이 다릅니다');
  const rows=normalWater(content,delayMinutes?endTime:Date.now(),hours);
  return {demo:false,delayMinutes,cutoffTime:end,station:String(station.obsnm),stationCode:station.wlobscd,hours,requestedFrom:start,requestedTo:end,historyUnavailable,rows,stale:Date.now()-parseStamp(rows.at(-1).time)>3600000};
}

function weatherBase(now,forecast) {
  // 실황은 매시 10분 이후, 초단기예보는 매시 45분 이후 조회. 5분 여유를 둔다.
  const lag=forecast?50:15;
  const s=kst(new Date(now-lag*60000));
  return {base_date:s.slice(0,8),base_time:s.slice(8,10)+(forecast?'30':'00')};
}

function weatherItems(json) {
  const r=json?.response;
  if(String(r?.header?.resultCode)!=='00') throw new Error(`기상청 응답 오류 (${String(r?.header?.resultCode??'형식 확인').slice(0,10)})`);
  const items=r?.body?.items?.item;
  if(!Array.isArray(items)||!items.length) throw new Error('기상청 자료가 없습니다');
  return items;
}

function weatherLabel(pty,sky) {
  const rain={1:'비 🌧️',2:'비/눈 🌨️',3:'눈 ❄️',4:'소나기 🌦️',5:'빗방울',6:'빗방울/눈날림',7:'눈날림'};
  return rain[pty] || ({1:'맑음 ☀️',3:'구름많음 ☁️',4:'흐림 ☁️'}[sky]) || (pty===0?'강수 없음':'강수 정보 없음');
}

function windDirection(value) {
  if(!numeric(value)||Number(value)<0||Number(value)>360) return '풍향 자료 없음';
  const names=['북','북북동','북동','동북동','동','동남동','남동','남남동','남','남남서','남서','서남서','서','서북서','북서','북북서'];
  return names[Math.round(Number(value)/22.5)%16]+'풍';
}

function rainLabel(value) {
  if(value===undefined||value===null||String(value).trim()===''||String(value).startsWith('-')) return '강수량 자료 없음';
  if(numeric(value)) return Number(value).toFixed(1)+' mm';
  const label=String(value).trim();
  return /^(강수없음|[\d.]+\s*mm(\s*(미만|이상))?|[\d.]+\s*[~～]\s*[\d.]+\s*mm)$/.test(label)?label:'강수량 자료 없음';
}

function villageBase(now=Date.now()) {
 const s=kst(new Date(now-20*60000)),hour=Number(s.slice(8,10));
 const eligible=[2,5,8,11,14,17,20,23].filter(h=>h<=hour);
 return eligible.length?{base_date:s.slice(0,8),base_time:String(eligible.at(-1)).padStart(2,'0')+'00'}:{base_date:kst(new Date(parseStamp(s.slice(0,8)+'0000')-86400000)).slice(0,8),base_time:'2300'};
}
function forecastHours(items,base) {
 if(items.some(r=>String(r.baseDate)!==base.base_date||String(r.baseTime).padStart(4,'0')!==base.base_time))throw new Error('요청 시각과 다른 단기예보 자료입니다');
 const grouped=new Map();for(const row of items){const time=String(row.fcstDate)+String(row.fcstTime).padStart(4,'0');if(!Number.isFinite(parseStamp(time)))continue;if(!grouped.has(time))grouped.set(time,{time});grouped.get(time)[row.category]=row.fcstValue;}
 return [...grouped.values()].sort((a,b)=>a.time.localeCompare(b.time));
}
function forecastPeriods(shortRows=[],ultraRows=[],now=Date.now()) {
 const today=kst(new Date(now)).slice(0,8),midnight=parseStamp(today+'0000');
 const short=shortRows.filter(r=>numeric(r.TMP)&&Number(r.TMP)>-90&&numeric(r.WSD)&&Number(r.WSD)>=0).map(r=>({time:r.time,temp:Number(r.TMP),wind:Number(r.WSD),direction:windDirection(r.VEC),rain:rainLabel(r.PCP),pop:numeric(r.POP)&&Number(r.POP)>=0&&Number(r.POP)<=100?Number(r.POP):null,desc:weatherLabel(Number(r.PTY),Number(r.SKY))}));
 const byTime=new Map(short.map(r=>[r.time,r]));for(const row of ultraRows)byTime.set(row.time,{...byTime.get(row.time),...row});
 const items=[3,5].map(h=>{const target=kst(new Date(Math.round((now+h*3600000)/3600000)*3600000)),r=byTime.get(target);return {id:'h'+h,label:h+'시간 후',time:target,...(r||{unavailable:true})};});
 for(const [offset,id,label] of [[1,'tomorrow','내일'],[2,'dayAfter','모레']]){
  const day=kst(new Date(midnight+offset*86400000)).slice(0,8),rows=shortRows.filter(r=>r.time.slice(0,8)===day),valid=short.filter(r=>r.time.slice(0,8)===day);
  if(!valid.length){items.push({id,label,day,unavailable:true});continue;}
  const mins=rows.filter(r=>numeric(r.TMN)&&Number(r.TMN)>-90).map(r=>Number(r.TMN)),maxs=rows.filter(r=>numeric(r.TMX)&&Number(r.TMX)>-90).map(r=>Number(r.TMX));
  const pops=valid.filter(r=>r.pop!==null).map(r=>r.pop),pty=Math.max(...rows.filter(r=>numeric(r.PTY)).map(r=>Number(r.PTY)),0),sky=Math.max(...rows.filter(r=>numeric(r.SKY)).map(r=>Number(r.SKY)),1);
  items.push({id,label,day,tempMin:mins.length?Math.min(...mins):Math.min(...valid.map(r=>r.temp)),tempMax:maxs.length?Math.max(...maxs):Math.max(...valid.map(r=>r.temp)),windMax:Math.max(...valid.map(r=>r.wind)),popMax:pops.length?Math.max(...pops):null,desc:weatherLabel(pty,sky),hours:valid.length,rangeSource:mins.length&&maxs.length?'official':'hourly'});
 }
 return {day:today,items};
}
async function villageData(zone,cfg) {
 const latest=villageBase();let base=latest;
 for(let attempt=0;attempt<2;attempt++){
  const params=new URLSearchParams({serviceKey:decodeKey(cfg.kma),pageNo:'1',numOfRows:'1000',dataType:'JSON',...base,nx:String(zones[zone].nx),ny:String(zones[zone].ny)});
  const json=await fetchJSON('https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst?'+params);
  if(String(json?.response?.header?.resultCode)==='03'&&attempt===0){const previous=kst(new Date(parseStamp(base.base_date+base.base_time)-3*3600000));base={base_date:previous.slice(0,8),base_time:previous.slice(8)};continue;}
  return {base,rows:forecastHours(weatherItems(json),base)};
 }
 throw new Error('단기예보 자료 게시 대기');
}

async function weatherData(zone,cfg) {
  if(!cfg.kma) throw new Error('기상청 서비스키 미입력');
  const query=async forecast=>{
    const base=weatherBase(Date.now(),forecast);
    const params=new URLSearchParams({serviceKey:decodeKey(cfg.kma),pageNo:'1',numOfRows:'1000',dataType:'JSON',...base,nx:String(zones[zone].nx),ny:String(zones[zone].ny)});
    const json=await fetchJSON(`https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/${forecast?'getUltraSrtFcst':'getUltraSrtNcst'}?${params}`);
    return {items:weatherItems(json),base};
  };
  const [ncst,fcst,village]=await Promise.allSettled([query(false),query(true),villageData(zone,cfg)]);
  if(ncst.status==='rejected') throw ncst.reason;
  const {items,base}=ncst.value;
  if(items.some(r=>String(r.baseDate)!==base.base_date || String(r.baseTime).padStart(4,'0')!==base.base_time)) throw new Error('요청 시각과 다른 기상청 관측 자료입니다');
  const obs=Object.fromEntries(items.map(r=>[r.category,r.obsrValue]));
  if(!numeric(obs.T1H)||!numeric(obs.WSD)||Number(obs.T1H)<-90||Number(obs.WSD)<0) throw new Error('기상청 기온·풍속 값이 유효하지 않습니다');
  const output={demo:false,time:base.base_date+base.base_time,temp:Number(obs.T1H),wind:Number(obs.WSD),direction:windDirection(obs.VEC),rain:rainLabel(obs.RN1),desc:weatherLabel(Number(obs.PTY)),forecast:[]};
  if(fcst.status==='fulfilled') {
    const grouped=new Map();
    for(const row of fcst.value.items) {const time=String(row.fcstDate)+String(row.fcstTime); if(!grouped.has(time)) grouped.set(time,{time});grouped.get(time)[row.category]=row.fcstValue;}
    output.forecast=[...grouped.values()].filter(r=>Number.isFinite(parseStamp(r.time))&&r.time>kst()&&numeric(r.T1H)&&Number(r.T1H)>-90&&numeric(r.WSD)&&Number(r.WSD)>=0).sort((a,b)=>a.time.localeCompare(b.time)).slice(0,6).map(r=>({time:r.time,temp:Number(r.T1H),wind:Number(r.WSD),direction:windDirection(r.VEC),rain:rainLabel(r.RN1),desc:weatherLabel(Number(r.PTY),Number(r.SKY))}));
    if(!output.forecast.length) output.forecastError='유효한 이후 시간 예보 없음';
  } else output.forecastError=reason(fcst.reason);
  output.periods=forecastPeriods(village.status==='fulfilled'?village.value.rows:[],output.forecast);
  if(village.status==='fulfilled'){
    const issuedAt=village.value.base.base_date+village.value.base.base_time;
    output.periods.issuedAt=issuedAt;
    // Retain hourly probabilities so the client can select the next five hours
    // again as the clock advances, without treating one hour as a five-hour total.
    output.probabilityForecast={issuedAt,rows:village.value.rows.filter(r=>Number.isFinite(parseStamp(r.time))&&numeric(r.POP)&&Number(r.POP)>=0&&Number(r.POP)<=100).map(r=>({time:r.time,pop:Number(r.POP)}))};
  }
  else output.periods.error=reason(village.reason);
  return output;
}

function normalTides(json,day) {
  if(String(json?.header?.resultCode)!=='00') throw new Error(`조석 API 응답 오류 (${String(json?.header?.resultCode??'형식 확인').slice(0,10)})`);
  const items=json?.body?.items?.item;
  const array=Array.isArray(items)?items:items?[items]:[];
  const rows=[];
  for(const r of array) {
    const time=String(r.predcDt??'').replace(/[- :T]/g,'').slice(0,12),code=Number(r.extrSe);
    if(r.obsvtrNm!=='인천'||!Number.isFinite(parseStamp(time))||time.slice(0,8)!==day||!numeric(r.predcTdlvVl)||![1,2,3,4].includes(code)) continue;
    rows.push({time,height:Number(r.predcTdlvVl),type:[1,3].includes(code)?'만조':'간조'});
  }
  if(!rows.length || rows.length!==array.length) throw new Error('인천 조석 예보의 시각·높이·지점 정보를 확인할 수 없습니다');
  return rows.sort((a,b)=>a.time.localeCompare(b.time));
}

async function tideData(cfg,day=kst().slice(0,8),options={}) {
  if(!/^\d{8}$/.test(day)||!Number.isFinite(parseStamp(day+'0000')))throw new Error('조석 조회 날짜를 확인하세요');
  const key=decodeKey(cfg.tide||cfg.kma);
  if(!key) throw new Error('조석예보 서비스키 미입력 · 공공데이터포털 인증키를 입력하세요');
  const params=new URLSearchParams({serviceKey:key,type:'json',obsCode:'DT_0001',reqDate:day,numOfRows:'300',pageNo:'1'});
  const json=await fetchJSON(`https://apis.data.go.kr/1192136/tideFcstHghLw/GetTideFcstHghLwApiService?${params}`,options);
  return {demo:false,day,rows:normalTides(json,day)};
}

async function tideWindowData(cfg,now=Date.now()){
 const day=kst(new Date(now)).slice(0,8),midnight=parseStamp(day+'0000'),days=[-1,0,1].map(offset=>kst(new Date(midnight+offset*86400000)).slice(0,8));
 const results=await Promise.allSettled(days.map(date=>tideData(cfg,date,{timeoutMs:5000,retries:0})));
 if(results[1].status!=='fulfilled')throw results[1].reason;
 const available=results.flatMap((r,index)=>r.status==='fulfilled'?[{day:days[index],rows:r.value.rows}]:[]);
 return {...results[1].value,nearbyRows:available.flatMap(item=>item.rows),nearbyDays:available.map(item=>item.day),nearbyIncomplete:available.length!==3};
}

export { zones, kst, parseStamp, fetchJSON, waterData, waterContent, normalWater, weatherData, tideData, tideWindowData, rainLabel, windDirection, villageBase, forecastHours, forecastPeriods };
