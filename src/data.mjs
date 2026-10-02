const zones = {
  ttukseom: { name:'뚝섬', station:'청담대교', nx:62, ny:126, sample:1.2 },
  yanghwa: { name:'양화/선유도', station:'한강대교', nx:58, ny:126, sample:1.5 },
  mangwon: { name:'망원', station:'행주대교', nx:58, ny:127, sample:1.6 },
  banpo: { name:'반포', station:'잠수교', nx:60, ny:125, sample:1.8 }
};
let tideCache=null;
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

async function fetchJSON(url, options={}) {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15000);
  try {
    const r=await fetch(url,{...options,signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
    if(!r.ok) throw new Error(`API 오류 (HTTP ${r.status})`);
    try { return await r.json(); } catch { throw new Error('JSON 응답이 아닙니다 · 인증키와 서비스 승인을 확인하세요'); }
  } finally { clearTimeout(timeout); }
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

async function weatherData(zone,cfg) {
  if(cfg.mode==='demo') return {demo:true,time:kst(),temp:23,wind:2.5,desc:'구름많음 ☁️',forecast:Array.from({length:6},(_,i)=>({time:kst(new Date(Date.now()+(i+1)*3600000)).slice(0,10)+'00',temp:23-i*.4,wind:2.5+i*.2,desc:'☁️'}))};
  if(!cfg.kma) throw new Error('기상청 서비스키 미입력');
  const query=async forecast=>{
    const base=weatherBase(Date.now(),forecast);
    const params=new URLSearchParams({serviceKey:decodeKey(cfg.kma),pageNo:'1',numOfRows:'1000',dataType:'JSON',...base,nx:String(zones[zone].nx),ny:String(zones[zone].ny)});
    const json=await fetchJSON(`https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/${forecast?'getUltraSrtFcst':'getUltraSrtNcst'}?${params}`);
    return {items:weatherItems(json),base};
  };
  const [ncst,fcst]=await Promise.allSettled([query(false),query(true)]);
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

async function tideData(cfg) {
  const day=kst().slice(0,8);
  if(cfg.mode==='demo') return {demo:true,day,rows:[['만조','0415',810],['간조','1030',120],['만조','1645',830],['간조','2310',100]].map(([type,hhmm,height])=>({type,time:day+hhmm,height}))};
  const key=decodeKey(cfg.tide||cfg.kma);
  if(!key) throw new Error('조석예보 서비스키 미입력 · 공공데이터포털 인증키를 입력하세요');
  if(tideCache?.day===day&&tideCache.key===key&&Date.now()-tideCache.loaded<300000) return tideCache.promise;
  const params=new URLSearchParams({serviceKey:key,type:'json',obsCode:'DT_0001',reqDate:day,numOfRows:'300',pageNo:'1'});
  const entry={day,key,loaded:Date.now()};
  entry.promise=fetchJSON(`https://apis.data.go.kr/1192136/tideFcstHghLw/GetTideFcstHghLwApiService?${params}`).then(json=>({demo:false,day,rows:normalTides(json,day)})).catch(e=>{if(tideCache===entry)tideCache=null;throw e;});
  tideCache=entry;return entry.promise;
}

export { zones, kst, weatherData, tideData, rainLabel, windDirection };
