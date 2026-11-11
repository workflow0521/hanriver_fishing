import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {kst} from '../src/data.mjs';
import {selectPublicData} from '../src/public-data.mjs';
import {publicTableRows} from '../src/hrfco-public.mjs';

const now=Date.parse('2026-11-11T09:01:00+09:00'),minute=60000;
const stamp=ago=>kst(new Date(now-ago*minute));
const day=stamp(0).slice(0,8);
const zone='ttukseom';
const rows=Array.from({length:38},(_,index)=>({time:stamp(371-10*index),value:1+index/100}));
const source={water:{[zone]:{hours:72,rows}},weather:{[zone]:{time:stamp(21),wind:3.2}},
 tides:{day,rows:[{time:day+'0400',type:'간조',height:70},{time:day+'1000',type:'만조',height:700}]}};

test('public adapter filters observations newer than the 15 minute cutoff and never invents rows',()=>{
 const water=selectPublicData(source,'water',zone,{hours:6},now);
 assert.equal(water.rows.at(-1).time,stamp(21));
 assert.equal(water.rows.at(-1).value,1.35);
 assert.equal(water.observationAgeMinutes,21);
 assert(!water.stale);
 assert.equal(water.rows.length,36);
 const later=selectPublicData(source,'water',zone,{},now+120*minute);
 assert(later.stale);
 assert.equal(later.rows.at(-1).time,stamp(1));
 assert.throws(()=>selectPublicData(source,'water',zone,{},now+25*60*minute),/갱신 대기/);
});

test('the river summary uses the actual delayed stage and independently available sources',()=>{
 const river=selectPublicData(source,'river',zone,{},now);
 assert.equal(river.summary.waterTime,stamp(21));
 assert.equal(river.summary.change1hCm,6);
 assert.equal(river.tides.rows.length,2);
 assert.equal(river.rain,null);
 assert.throws(()=>selectPublicData(source,'weather',zone,{},now+120*minute),/갱신 대기/);
 assert.throws(()=>selectPublicData(source,'tides','',{},now+24*60*minute),/갱신 대기/);
 assert.throws(()=>selectPublicData(source,'advice',zone,{},now),/공개 AI 조언/);
});

test('the generated Pages app loads from a repository path without calling the private service',async()=>{
 const html=await readFile(new URL('../site/index.html',import.meta.url),'utf8');
 const manifest=JSON.parse(await readFile(new URL('../site/manifest.webmanifest',import.meta.url),'utf8'));
 assert.match(html,/\.\/modules\/public-data\.mjs/);
 assert.match(html,/6시간 수위표/);
 assert.match(html,/navigator\.serviceWorker\.register\('\.\/sw\.js'/);
 assert.doesNotMatch(html,/fetch\('\/api\/data|href="\/(?:manifest|favicon)|로그인 후 다시 열어/);
 assert.equal(manifest.start_url,'./');
 assert.equal(manifest.scope,'./');
 assert(manifest.icons.every(icon=>icon.src.startsWith('./')));
});

test('the public station table parser verifies the gauge, units and time window',()=>{
 const spec={id:'wlobscd',code:'1018662',value:'wl'};
 const row=(ymdhm,wl)=>({ymdhm,wl,wlobscd:spec.code});
 const from=Date.parse('2026-11-11T08:00:00+09:00'),to=Date.parse('2026-11-11T08:40:00+09:00');
 const observed=publicTableRows([
  row('2026-11-11 08:50',2),row('2026-11-11 08:40','0.95'),
  row('2026-11-11 08:30','-9999'),row('2026-11-11 08:20',''),
  row('2026-11-11 08:10',1.03),row('2026-11-11 07:50',1.1),
 ],spec,from,to);
 assert.deepEqual(observed,[{time:'202611110810',value:1.03},{time:'202611110840',value:0.95}]);
 assert.throws(()=>publicTableRows([{...row('2026-11-11 08:40',1),wlobscd:'1018680'}],spec,from,to),/관측소/);
});
