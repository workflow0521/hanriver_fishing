import {zones,kst,parseStamp} from './data.mjs';
import {koreaSeason,communityFor,OUNCE_SIZES} from './lure-context.mjs';
export const ADVICE_VERSION='lure-v2-season-oz';
export const SPECIES=[{id:'sogari',name:'쏘가리'},{id:'jeomnongeo',name:'점농어'},{id:'megi',name:'메기'},{id:'gangjunchi',name:'강준치'},{id:'bass',name:'배스'}];
const lessonFields=['conditions','lure','technique','adjustment'];
function waterSummary(water){
 const rows=(water?.rows||[]).filter(r=>Number.isFinite(r.value)&&Number.isFinite(parseStamp(r.time))),last=rows.at(-1);
 if(!last)return null;
 const values=rows.map(r=>r.value),change=minutes=>{const before=rows.find(r=>parseStamp(r.time)===parseStamp(last.time)-minutes*60000);return before?Number((last.value-before.value).toFixed(3)):null;};
 return {average:rows.length>1?Number((values.reduce((a,b)=>a+b,0)/values.length).toFixed(3)):null,min:Math.min(...values),max:Math.max(...values),sampleCount:rows.length,from:rows[0].time,to:last.time,hours:water.hours||6,change10m:change(10),change1h:change(60),basis:'조회된 유효 관측값의 산술평균. 결측 구간은 채우지 않음. 평년 수위·현장 수심이 아님.'};
}
export function adviceContext(observations,now=Date.now()) {
 const context={};
 const recent=(time,hours)=>{const age=now-parseStamp(time);return Number.isFinite(age)&&age>=-60000&&age<=hours*3600000;};
 for(const zone of Object.keys(zones)) {
  const input=observations[zone]||{},last=input.water?.rows?.at(-1);
  const water=input.water&&!input.water.demo&&!input.water.stale&&last&&recent(last.time,1)?input.water:null;
  const weather=input.weather&&!input.weather.demo&&recent(input.weather.time,2)?input.weather:null;
  const tides=input.tides&&!input.tides.demo&&input.tides.day===kst(new Date(now)).slice(0,8)&&input.tides.rows?.length?input.tides:null;
  if(!water&&!weather&&!tides)continue;
  const season=koreaSeason(now),community=Object.fromEntries(SPECIES.map(s=>[s.id,communityFor(s.id,season)]));
  context[zone]={한국월계절:season,국내조행기참고:community,지그헤드싱커규격:OUNCE_SIZES,구역:zones[zone].name,기준시각KST:kst(new Date(now)),참고관측소:water?.station||null,수위단위:water?'m':null,수위최근관측:water?.rows.at(-1)||null,수위요약:waterSummary(water),수위시계열:water?.rows||null,날씨:weather,날씨단위:weather?{기온:'°C',풍속:'m/s',강수량:'mm'}:null,인천조석참고:tides,미관측항목:['현장 수온','현장 유속·유향','탁도','대상어 서식·입질','현장 수심'],누락자료:[!water&&'수위',!weather&&'날씨',!tides&&'인천 조석'].filter(Boolean)};
 }
 return context;
}
export function validateAdvice(payload,context,now=Date.now()) {
 const result={},valid=(s,max)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;
 for(const zone of Object.keys(context)) {
  const entry=payload?.[zone],c=context[zone];
  if(!valid(entry?.environment,1200)||!entry.lessons||SPECIES.some(s=>lessonFields.some(f=>!valid(entry.lessons[s.id]?.[f],800))))throw new Error('어종별 루어 강의 응답 형식 확인 필요');
  const species=SPECIES.map(s=>({...s,...Object.fromEntries(lessonFields.map(f=>[f,entry.lessons[s.id][f].trim()])),community:c.국내조행기참고?.[s.id]||null}));
  const summary=entry.environment.trim(),labels=['조건 해석','루어 선택','운용 순서','반응 없을 때'];
  const text=summary+'\n\n'+species.map(s=>s.name+'\n'+lessonFields.map((f,i)=>labels[i]+': '+s[f]).join('\n')).join('\n\n');
  result[zone]={version:ADVICE_VERSION,season:c.한국월계절,summary,species,text,generatedAt:new Date(now).toISOString(),waterTime:c.수위최근관측?.time||null,weatherTime:c.날씨?.time||null,tideDay:c.인천조석참고?.day||null,waterSummary:c.수위요약,sources:[c.수위최근관측&&'수위',c.날씨&&'날씨',c.인천조석참고&&'인천 조석'].filter(Boolean),missing:c.누락자료};
 }
 return result;
}
export function reusableAdvice(previous,observations,now=Date.now()) {
 if(!previous?.data)return false;
 const context=adviceContext(observations,now),keys=Object.keys(context);
 return keys.length>0&&keys.every(zone=>{
  const entry=previous.data[zone],age=now-Date.parse(entry?.generatedAt),c=context[zone];
  return entry?.version===ADVICE_VERSION&&entry.species?.length===SPECIES.length&&typeof entry?.text==='string'&&Number.isFinite(age)&&age>=0&&age<900000&&entry.waterTime===(c.수위최근관측?.time||null)&&entry.weatherTime===(c.날씨?.time||null)&&entry.tideDay===(c.인천조석참고?.day||null);
 });
}
export async function generateAdvice(observations,key,model='gemini-3.1-flash-lite') {
 const context=adviceContext(observations),required=Object.keys(context);
 if(!key)throw new Error('Gemini 비밀 설정 확인 필요');
 if(!required.length)throw new Error('최신 수위·날씨 또는 오늘 조석 자료를 먼저 조회해 주세요.');
 const lessonSchema={type:'OBJECT',properties:Object.fromEntries(lessonFields.map(f=>[f,{type:'STRING'}])),required:lessonFields};
 const zoneSchema={type:'OBJECT',properties:{environment:{type:'STRING'},lessons:{type:'OBJECT',properties:Object.fromEntries(SPECIES.map(s=>[s.id,lessonSchema])),required:SPECIES.map(s=>s.id)}},required:['environment','lessons']};
 const properties=Object.fromEntries(required.map(zone=>[zone,zoneSchema]));
 const prompt=`당신은 한강 현장에서 초보자에게 루어낚시를 가르치는 강사입니다. 한국어로 구역별 맞춤 수업을 작성하세요. 기준시각과 한국월계절은 서버가 제공한 실제 KST 연월일입니다. 한국월계절.label(예: 10월 중순·한국 가을)을 environment에 반드시 명시하고 해당 월·계절의 한국 강계 루어 탐색 특성을 반영하세요. 월만으로 수온이나 어류 활성 임계값을 정하지 말고 당일 관측 기온·바람·수위로 다시 조정하세요. 안전 주의만 나열하지 말고 왜 이 루어를 고르고 어떻게 던지고 감는지 가르치세요.
반드시 쏘가리(sogari), 점농어(jeomnongeo), 메기(megi), 강준치(gangjunchi), 배스(bass) 5종을 각각 분리합니다. 다른 농어류를 점농어로 바꿔 말하지 마세요. 해당 구역에서 5종 모두 서식하거나 잡힌다고 단정하지 말고, 특히 점농어는 현장 서식·염분 영향·출현 확인을 전제로 설명하세요.
environment에는 현재 실제 기온·풍속·풍향·강수, 참고 관측소의 최신 수위와 최근 조회 구간 평균·1시간 변화 중 있는 값만 해석하고, 인천 고저조 참고 여부와 중요한 누락을 3~4문장으로 정리하세요. 평균은 결측을 채우지 않은 관측값 산술평균이며 평년·정상 수위가 아닙니다. 수위가 연결되어 있으면 최신 수위와 수위요약.average(있을 때)를 숫자와 m 단위로 반드시 포함하고 평균의 관측 건수도 제시하세요. 수위 상승/하강/변화 없음은 실제 변화값에 맞게 말하세요.
국내조행기참고는 사람이 직접 확인한 공개 조행기입니다. 검색을 했다고 말하지 말고 이 자료의 조행일·게시일·지역·계절 일치 여부와 제한을 읽으세요. 같은 달/계절의 실제 채비 조과 사례에서 정확히 확인된 채비가 있으면 lure 필드의 첫 출발 채비로 그 규격과 웜 크기를 소개하세요. 예를 들어 같은 달 한강 1/16oz 사례를 제시한 후, 현장 바닥 접촉이 안 될 때 3/32oz·1/8oz 순으로 시험하는 이유를 설명하세요. 관측소 수위나 약한 바람만으로 무조건 무겁게 정하지 마세요. 정확 무게가 확인되지 않은 자료는 무게를 채워 넣지 말고 일반 운용 예시로 구분하세요. 해당 어종의 채비 선택 이유로 활용하되 오래된 자료를 최근 인기·올해 조과로 포장하지 마세요. 다른 계절은 채비 사용 예시일 뿐이며 현재 월의 검증 사례가 아닙니다. 자료가 부족한 어종은 '최근 한강 조과 근거 부족'을 짧게 밝히고 일반 운용 제안으로 전환하세요. 추천·댓글이 있다는 사실을 채비 효과 검증이나 대중적 인기 통계로 바꾸지 마세요. 없는 출처·특정 상품 유행을 만들지 마세요.
지그헤드·싱커 표기는 반드시 oz 규격을 먼저 쓰세요. 예: 1/16oz(약 1.8g), 3/32oz(약 2.7g), 1/8oz(약 3.5g), 3/16oz(약 5.3g), 1/4oz(약 7.1g). 2~3g 전체를 1/16oz로 같은 무게라고 치환하면 안 됩니다. 초보자에게 한강 전역의 최적 무게처럼 고정하지 말고 실제 흐름·바닥 접촉·로드 허용 중량에 따라 한 단계씩 조절하세요.
각 어종 lessons의 필드:
conditions: 실제 제공된 기온·바람·수위 변화와 그 어종의 탐색 전략을 연결하는 이유. 자료가 없으면 조건부로 설명. 서식 확인 전제 포함.
lure: 먼저 시도할 루어 종류와 필요한 경우 시작 크기·무게 범위(지그헤드·싱커는 1/16oz·3/32oz·1/8oz·3/16oz·1/4oz 같은 실제 통용 규격 우선, 괄호에 약 g 보조. 웜은 2~3인치 같은 통용 크기, 미노우는 cm). 이것은 관측값이 아닌 일반적인 출발 예시이며 실제 흐름·수심·캐스팅 가능 여부에 따라 조절한다고 설명.
technique: 서 있을 위치·캐스팅 방향, 탐색 수심층, 릴링 속도·멈춤·액션을 순서대로 가르치는 2~3문장. 초보자에게 바닥 접촉·입질·바람에 뜨는 라인을 어떻게 구분하고 조절하는지도 어종에 맞게 설명. 입질은 반복 확인하며 단정하지 마세요. 침강성 웜은 멈추면 가라앉으므로 정지시 저절로 뜬다는 잘못된 설명은 금지합니다.
adjustment: 반응이 없을 때 무엇을 관찰하고 무엇부터 바꿀지, 기온·바람·수위 조건이 변할 때 운용을 어떻게 바꿀지 구체적인 1~2문장.
각 필드 60~130자, 각 어종 합계 300~450자 정도로 핵심을 설명하고 같은 일반론을 5번 반복하지 마세요. 로드 허용 중량 안에서 한 번에 무게·수층·속도 중 하나씩 바꾸게 하세요. 밑걸림이 잦으면 계속 바닥을 긁거나 무게를 늘리라고 하지 말고 무게·경로·각도를 조절하도록 하세요. 쏘가리는 돌·은신처가 실제로 보이면 지그헤드+웜을 비스듬히 던져 바닥 가까이 짧은 리프트와 폴, 점농어는 출현과 먹잇감 확인 후 흐름 경계 중상층에서 미노·섀드를 일정 회수와 멈춤, 메기는 완류·그늘·수초 가장자리가 확인되면 저층 섀드·그럽의 짧은 이동과 정지, 강준치는 베이트 추격 확인 후 중상층 미노·스푼을 먼저 일정 회수하고 무반응 시 침강 시간 변경, 배스는 완류·커버 가장자리가 보이면 웜·텍사스의 폴링과 짧은 이동·정지를 조건부 출발 전략으로 활용하세요. 이는 생태 기반 시험 전략이며 현장 상태·성과를 확정하는 사실이 아닙니다. 현장에서 확인하지 않은 구조물·수심·유속·입질을 사실처럼 쓰지 마세요. 수위 하강만으로 쏘가리·배스가 바닥에 밀착할 확률이 높거나 메기의 활성이 낮다고 단정하지 마세요. 수위 변화는 드러난 지형이나 흐름 경계를 현장에서 다시 확인해야 하는 이유로 설명하세요. 기온 추세가 입력에 없으면 기온이 오르거나 내린다고 말하지 마세요. 자료 부재를 근거로 어류가 바닥에 있을 확률이 높다거나 기온 하강 때문에 활성이 떨어졌다고 추론하지 마세요.
입력은 공식 관측·예보이고 시각은 KST입니다. 수위 m, 인천 조위 cm, 기온 °C, 풍속 m/s, 강수량 mm 단위를 지키세요. 기온은 수온이 아닙니다. 수온을 임의 생성하거나 기온만으로 어류 활성·산란을 확정하지 마세요. 관측소 수위·평균 수위는 공원 현장 수심이 아닙니다. 수위 변화 원인을 강수·방류·조석 중 하나로 확정하지 마세요.
인천 조석은 인천 기준 고·저조 참고입니다. 한강 현장 물때·조차·수위 변화·유속·물돌이 도착시각으로 환산하지 마세요. 인천 만조 전후라는 이유만으로 한강 입질 시간을 찍지 마세요. 현장 물의 흐름과 먹잇감 움직임으로 확인하는 법을 설명하세요. null·누락 자료는 관측된 것처럼 추정하지 말고 해당 판단 불가를 밝히세요.
낚시 성과·안전·허용을 보장하지 마세요. 확인하지 않은 금지·해제·법정 기준을 만들지 말고 통제·낚시 가능 구간은 별도 확인이라는 짧은 문장 한 번만 덧붙이세요. 수업 본문에는 조건 해석과 운용 방법을 우선하세요.
자료: `+JSON.stringify(context);
 const generationConfig={responseMimeType:'application/json',responseSchema:{type:'OBJECT',properties,required},maxOutputTokens:8192};
 if(/^gemini-3\./.test(model))generationConfig.thinkingConfig={thinkingLevel:'low'};
 let response;
 for(let attempt=0;attempt<2;attempt++){
  try{response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},signal:AbortSignal.timeout(35000),body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig})});}
  catch(error){if(attempt===0&&(error?.name==='TimeoutError'||error?.name==='AbortError'||error instanceof TypeError))continue;throw new Error('Gemini 응답 지연 · 잠시 후 다시 요청해 주세요.');}
  if(response.ok)break;
  const status=response.status;
  if(attempt===0&&[500,502,503,504].includes(status)){await response.body?.cancel();await new Promise(resolve=>setTimeout(resolve,750));continue;}
  await response.body?.cancel();throw new Error('Gemini HTTP '+status);
 }
 const body=await response.json(),raw=body.candidates?.[0]?.content?.parts?.filter(p=>!p.thought).map(p=>p.text||'').join('');
 let parsed;try{parsed=JSON.parse(raw);}catch{throw new Error('어종별 루어 강의 응답 형식 확인 필요');}
 const result=validateAdvice(parsed,context);
 for(const data of Object.values(result))data.model=model;
 return result;
}
