/* Static shell only; never cache user data, generated PDFs or file uploads. */
const CACHE='toolbox-shell-v6', ROOT=new URL('./',self.registration.scope);
const CORE=['./','./index.html','./shared/shell.js','./shared/shell.css','./manifest.webmanifest','./icons/app-icon.svg','./merchant-calculator/','./merchant-calculator/app.js','./merchant-calculator/style.css','./receipt/','./receipt/app.js','./receipt/style.css','./estimate/','./estimate/app.js','./estimate/style.css','./before-after-tsukurukun/'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(async c=>{for(const p of CORE){try{await c.add(new Request(new URL(p,ROOT),{cache:'reload'}))}catch(_){/* Missing files on first deployment are tolerated */}}})));
self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const k of await caches.keys())if(k.startsWith('toolbox-shell-')&&k!==CACHE)await caches.delete(k);await self.clients.claim()})()));
self.addEventListener('fetch',e=>{
 const q=e.request,u=new URL(q.url);
 if(q.method!=='GET'||u.origin!==self.location.origin||!u.pathname.startsWith(ROOT.pathname))return;
 if(q.mode==='navigate'){
  e.respondWith(fetch(q).then(async r=>{if(r.ok){const c=await caches.open(CACHE);await c.put(q,r.clone())}return r}).catch(()=>caches.match(q).then(x=>x||caches.match(new URL('./',ROOT)))));return;
 }
 if(!/\.(?:css|js|svg|webmanifest)$/i.test(u.pathname))return;
 e.respondWith(caches.match(q).then(cached=>cached||fetch(q).then(async res=>{if(res.ok)(await caches.open(CACHE)).put(q,res.clone());return res})));
});
