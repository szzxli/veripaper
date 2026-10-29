// web/index.html is a redirect page (since 2026-10-27): the papers app lives at verifycites.com/papers/.
// Replaces the old app-page tests (bibtex.js, invalid_doi.js, keyless.js, network.js) that drove the removed UI.
const fs = require('fs'), path = require('path'), assert = require('assert');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const TARGET = /^https:\/\/verifycites\.com\/papers\/(\?(?:[^"#]*&)?ref=[a-z0-9-]+[^"#]*)?$/i;
const refresh = html.match(/<meta http-equiv="refresh" content="0; url=([^"]+)">/i);
assert(refresh && TARGET.test(refresh[1]), 'meta refresh (0s) to verifycites.com/papers/');
const js = html.match(/window\.location\.replace\("([^"]+)"\)/);
assert(js && TARGET.test(js[1]), 'location.replace to verifycites.com/papers/');
const canon = html.match(/<link rel="canonical" href="([^"]+)">/i);
assert(canon && canon[1] === 'https://verifycites.com/papers/', 'canonical is verifycites.com/papers/');
assert(/<a href="https:\/\/verifycites\.com\/papers\/[^"]*">/.test(html), 'fallback link for no-JS / no-refresh');
assert(!/<script[^>]*src=/.test(html), 'redirect page loads no scripts (no app, no counter)');
console.log('redirect: 5/5 passed');
