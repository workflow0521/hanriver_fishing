import {spawnSync} from 'node:child_process';
import {publicHydrology} from '../src/hrfco-public.mjs';
import {validateHydrologyHandoff} from '../src/hydrology-handoff.mjs';
import {zones} from '../src/data.mjs';

const owner='workflow0521',repo='hanriver_fishing';
const collectedAt=new Date().toISOString();
const raw={schema:1,collectedAt,water:{}};
for(const zone of Object.keys(zones)){
 try{raw.water[zone]=await publicHydrology('water',zone,24);}catch{console.warn(zone+': 수위 실측 조회 실패');}
}
for(const [source,hours] of [['dam',6],['rain',24]]){
 try{raw[source]=await publicHydrology(source,'',hours);}catch{console.warn(source+': 기관 관측 조회 실패');}
}
const payload={schema:1,collectedAt,...validateHydrologyHandoff(raw)};
const zonesReady=Object.keys(payload.water);
if(!zonesReady.length)throw Error('홍수통제소의 최신 수위 관측을 받지 못했습니다. 기존 배포는 유지합니다.');
const body=JSON.stringify({event_type:'hydrology-refresh',client_payload:payload});
if(Buffer.byteLength(body,'utf8')>60000)throw Error('수문자료 전달 분량 초과');
console.log(JSON.stringify({collectedAt,water:Object.fromEntries(zonesReady.map(zone=>[zone,{rows:payload.water[zone].rows.length,last:payload.water[zone].rows.at(-1).time}])),dam:payload.dam?.rows.length,rain:payload.rain?.rows.length}));
if(process.argv.includes('--check'))process.exit(0);

// Obtain only the existing GitHub login; never print or write the credential to a file.
const credential=spawnSync('git',['credential','fill'],{
 input:'protocol=https\nhost=github.com\npath='+owner+'/'+repo+'.git\n\n',
 env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'},
 encoding:'utf8',stdio:['pipe','pipe','ignore'],timeout:8000,
});
const token=credential.stdout?.split(/\r?\n/).find(line=>line.startsWith('password='))?.slice(9);
if(!token||credential.status!==0)throw Error('GitHub에 쓰기 가능한 계정으로 먼저 로그인해 주세요.');
const response=await fetch('https://api.github.com/repos/'+owner+'/'+repo+'/dispatches',{
 method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),body,
 headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},
});
if(response.status!==204)throw Error('GitHub 수문자료 갱신 요청 실패 (HTTP '+response.status+')');
console.log('GitHub Pages에 공식 관측 자료 갱신을 요청했습니다.');
