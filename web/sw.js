const C='veripaper-v6';
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(['index.html','ground.js','idea.js','manifest.json'])));self.skipWaiting();});
self.addEventListener('fetch',e=>{e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));});
