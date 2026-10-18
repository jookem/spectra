// SPECTRA service worker: installs the app shell so the app opens offline.
// HTML is network-first (picks up new builds), everything else cache-first.
//
// Releasing: bump B here AND the ?v= on every <script> in VJ Fractal.dc.html
// to the same value, and the "Build N" label there (twice). A new B drops every older cache, so a script that changed
// can never be served stale from here; the query keeps the browser's own HTTP
// cache from handing back the old file while the new cache fills.
const B='b17', V='spectra-'+B;
const SCRIPTS=['support.js','vj-engine.js','deep-zoom.js','cam-fly.js','wave-mesh.js','wave-gl.js'].map(f=>'./'+f+'?v='+B);
const SHELL=['./','./index.html','./VJ%20Fractal.dc.html',...SCRIPTS,'./csi.js','./manifest.webmanifest',
  './icon-192.png','./icon-512.png','./icon-maskable-512.png','./apple-touch-icon.png','./favicon-32.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>Promise.all(SHELL.map(u=>c.add(u).catch(()=>{})))).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const r=e.request; if(r.method!=='GET') return;
  const u=new URL(r.url); if(!/^https?:/.test(u.protocol)) return;
  const html=r.mode==='navigate'||(r.headers.get('accept')||'').includes('text/html');
  if(html){ e.respondWith(fetch(r).then(res=>{ const cp=res.clone(); caches.open(V).then(c=>c.put(r,cp)); return res; }).catch(()=>caches.match(r,{ignoreSearch:true}).then(m=>m||caches.match('./VJ%20Fractal.dc.html')))); return; }
  e.respondWith(caches.match(r).then(m=>m||fetch(r).then(res=>{ if(res.ok||res.type==='opaque'){ const cp=res.clone(); caches.open(V).then(c=>c.put(r,cp)); } return res; })));
});
