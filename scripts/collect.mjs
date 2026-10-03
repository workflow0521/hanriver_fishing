import {mkdir,writeFile} from 'node:fs/promises';
import {zones,waterData,weatherData,tideData} from '../src/data.mjs';

const output=new URL('../site/data/',import.meta.url);
await mkdir(output,{recursive:true});
const key=process.env.PUBLIC_DATA_API_KEY||'';
const waterKey=process.env.HRFCO_API_KEY||'';
const config={mode:'live',kma:key,tide:key,waterSource:'hrfco',hrfco:waterKey};
let succeeded=0,failed=0;
async function save(name,request,available=!!key){
  let payload;
  try {
    if(!available)throw new Error('key missing');
    payload={data:await request(),collectedAt:new Date().toISOString()};succeeded++;
  }catch{
    // Never include raw upstream bodies, request URLs or credentials in public artifacts/logs.
    payload={error:available?'제공기관 자료 조회 실패 · 다음 갱신 때 다시 확인합니다':'API 연결 설정 대기',collectedAt:new Date().toISOString()};failed++;
  }
  await writeFile(new URL(name+'.json',output),JSON.stringify(payload));
}
for(const zone of Object.keys(zones))await save('weather-'+zone,()=>weatherData(zone,config));
for(const zone of Object.keys(zones))await save('water-'+zone,()=>waterData(zone,config),!!waterKey);
await save('tides',()=>tideData(config));
console.log(`Data collection: ${succeeded} ready, ${failed} pending/unavailable.`);
