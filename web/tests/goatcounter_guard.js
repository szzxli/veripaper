// GoatCounter test-visit guard: runs the page's own inline loader against fake window/document/location.
// Run: node web/tests/goatcounter_guard.js
const fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(ROOT, '_includes/head-custom.html'), 'utf8');
const m = html.match(/<script>(\/\* GoatCounter loader:[\s\S]*?)<\/script>/);
assert(m, 'GoatCounter loader found');
const CASES = [ // [query, flag before, counted?, flag after]
  ['', null, true, null], ['?ref=gh-x', null, true, null], ['?nav=1', null, true, null],
  ['?nocount=1', null, false, 't'], ['?ref=x&nocount=1', null, false, 't'], ['', 't', false, 't'],
  ['?nocount=0', 't', false, null], ['?v=20261029', null, false, null], ['?cb=3', null, false, null],
  ['?cachebust', null, false, null], ['?cachebust=1', null, false, null], ['?a=1&_=123', null, false, null],
];
let n = 0;
for (const [q, flag, counted, after] of CASES) {
  const store = {}; if (flag) store.skipgc = flag;
  const added = [];
  const w = { localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } } };
  const el = { setAttribute(k, v) { this[k] = v; } };
  const d = { createElement: () => el, head: { appendChild: e => added.push(e) } };
  new Function('window', 'document', 'location', m[1])(w, d, { search: q });
  const loaded = added.length === 1 && added[0]['data-goatcounter'] === 'https://szzxli.goatcounter.com/count' && added[0].src === 'https://gc.zgo.at/count.js';
  assert.strictEqual(loaded, counted, `count.js loaded for "${q}" (flag ${flag})`);
  assert.strictEqual(w.gcSkip, !counted, `gcSkip for "${q}"`);
  assert.strictEqual(store.skipgc || null, after, `skipgc after "${q}"`);
  n++;
}
console.log(`goatcounter guard: ${n}/${CASES.length} cases passed`);
assert(!/<script[^>]*data-goatcounter=[^>]*src="https:\/\/gc\.zgo\.at\/count\.js"/.test(html), 'no static count.js tag bypasses the guard');
assert(fs.readFileSync(path.join(ROOT, 'web/analytics.js'), 'utf8').includes('if (window.gcSkip) return;'), 'analytics.js events respect the guard');
const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
assert(readme.split('\n')[0].includes('https://verifycites.com/papers/?ref=gh-veripaper'), 'README first line points to verifycites.com/papers with ?ref=gh-veripaper');
for (const u of readme.match(/https:\/\/(szzxli\.github\.io\/(soc-skills|soc-home-lab|veripaper)|verifycites\.com)[^\s)\]>"']*/g) || [])
  assert(/[?&]ref=gh-veripaper/.test(u), 'README link carries ?ref=gh-veripaper: ' + u);
console.log('goatcounter guard + README ref tags: ok');
