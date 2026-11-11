import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const write = (path, contents) => writeFile(new URL(path, root), contents);
const copy = (from, to) => copyFile(new URL(from, root), new URL(to, root));
const replace = (source, before, after) => {
  if (!source.includes(before)) throw Error('Missing Pages adapter target: ' + before);
  return source.replaceAll(before, after);
};

await mkdir(new URL('site/modules/', root), {recursive:true});
let html = await read('dashboard/index.html');
const from = html.indexOf('async function serverData(');
const to = html.indexOf('\n}', from);
if (from < 0 || to < 0) throw Error('Dashboard request adapter not found');
html = html.slice(0, from) + `async function serverData(kind,zone='',method='GET',hours=6,force=false,mode='quick') {
 if(!navigator.onLine)throw new Error('인터넷에 다시 연결해 주세요.');
 const {publicData}=await import('./modules/public-data.mjs');
 return publicData(kind,zone,{hours,force,mode});
}` + html.slice(to + 2);
for (const path of ['favicon.svg','manifest.webmanifest','apple-touch-icon.png']) html=replace(html,'href="/'+path+'"','href="./'+path+'"');
html=replace(html,"navigator.serviceWorker.register('/sw.js',{scope:'/',","navigator.serviceWorker.register('./sw.js',{scope:'./',");
html=replace(html,'지도와 움직임으로 보는 오늘의 한강','지도와 움직임으로 보는 오늘의 한강</p><p class="small">공개 자료 · 약 15분 간격 갱신 시도');
html=replace(html,'연결된 공식 자료로 Gemini 조언을 요청합니다','최근 게시된 Gemini 조언을 조회합니다');
html=replace(html,'Gemini가 현재 자료를 참고해 5종의 루어 선택과 운용 수업을 작성하고 있습니다…','최근 게시된 어종별 조언을 확인하고 있습니다…');
if(/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA||''))html=replace(html,'</head>','<meta name="build-revision" content="'+process.env.GITHUB_SHA+'"></head>');
await write('site/index.html',html);
await write('site/.nojekyll','');
for(const name of ['public-data','data','delayed-water','river-data','river-state','water-turn'])await copy('src/'+name+'.mjs','site/modules/'+name+'.mjs');
for(const name of ['favicon.svg','icon-192.png','icon-512.png','icon-maskable-512.png','apple-touch-icon.png'])await copy('dashboard/assets/'+name,'site/'+name);
const manifest=JSON.parse(await read('dashboard/assets/manifest.webmanifest'));
for(const name of ['id','start_url','scope'])manifest[name]='./';
for(const icon of manifest.icons)icon.src='.'+icon.src;
await write('site/manifest.webmanifest',JSON.stringify(manifest,null,2)+'\n');
await write('site/offline.html',(await read('dashboard/assets/offline.html')).replaceAll('src="/','src="./').replaceAll('href="/','href="./'));
await write('site/sw.js',`const CACHE='hangang-pages-v1',BASE=new URL('./',self.registration.scope),offline=new URL('offline.html',BASE).href;
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.add(offline))));
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{
 if(e.request.method==='GET'&&e.request.mode==='navigate'&&e.request.url.startsWith(BASE.href))
  e.respondWith(fetch(e.request).catch(async()=>await caches.match(offline)||new Response('인터넷에 연결해 주세요.',{status:503})));
});\n`);
