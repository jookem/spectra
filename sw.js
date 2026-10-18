// SPECTRA service worker: installs the app shell so the app opens offline.
// HTML is network-first (picks up new builds), everything else cache-first.
const V='spectra-v8';
const SHELL=['./','./index.html','./VJ%20Fractal.dc.html','./support.js','./vj-engine.js?v=terr3','./deep-zoom.js','./cam-fly.js?v=grav9','./wave-mesh.js','./wave-gl.js','./csi.js','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>Promise.all(SHELL.map(u=>c.add(u).catch(()=>{})))).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const r=e.request; if(r.method!=='GET') return;
  const u=new URL(r.url); if(!/^https?:/.test(u.protocol)) return;
  const html=r.mode==='navigate'||(r.headers.get('accept')||'').includes('text/html');
  if(html){ e.respondWith(fetch(r).then(res=>{ const cp=res.clone(); caches.open(V).then(c=>c.put(r,cp)); return res; }).catch(()=>caches.match(r).then(m=>m||caches.match('./VJ%20Fractal.dc.html')))); return; }
  e.respondWith(caches.match(r).then(m=>m||fetch(r).then(res=>{ if(res.ok||res.type==='opaque'){ const cp=res.clone(); caches.open(V).then(c=>c.put(r,cp)); } return res; })));
});
