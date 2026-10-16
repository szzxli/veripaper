const C='veripaper-v11';
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(['index.html','project.js','ground.js','idea.js','datasets.js','venues.js','rebuttal.js','manifest.json'])));self.skipWaiting();});
self.addEventListener('fetch',e=>{e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));});
