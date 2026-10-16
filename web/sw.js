const C='veripaper-v15';
const FILES=['index.html','project.js','ground.js','idea.js','datasets.js','venues.js','rebuttal.js','manifest.json'];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(C).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys()
      .then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});
// network-first: fresh code on every load; cache fallback keeps it working offline
self.addEventListener('fetch',e=>{
  e.respondWith(
    fetch(e.request).then(r=>{
      const cp=r.clone();
      caches.open(C).then(c=>c.put(e.request,cp));
      return r;
    }).catch(()=>caches.match(e.request))
  );
});
