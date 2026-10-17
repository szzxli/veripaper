/* veripaper web regression: v19 request queue + cache —
 * 1. vpFetch spaces per-host requests (polite gaps)
 * 2. 429 retries with backoff, gives up after 3 -> caller sees 429
 * 3. persistent cache: roundtrip, TTL expiry, graceful without localStorage
 * 4. abstract dedup: same paper cited N times = 1 fetch
 * 5. ABSTRACT-SUPPORTED label end to end
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'ground.js'), 'utf8');

function mkEl() {
  return {
    value: '', textContent: '', innerHTML: '', disabled: false, style: {}, dataset: {},
    addEventListener() {}, click() {}, scrollIntoView() {}, appendChild() {}, remove() {},
  };
}
function makeSandbox(fetchImpl, storage) {
  const store = {};
  const sandbox = {
    console,
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id),
    document: {
      readyState: 'complete', addEventListener: () => {},
      getElementById: () => mkEl(), createElement: () => mkEl(), body: mkEl(),
    },
    window: {}, navigator: {}, location: { href: '' },
    fetch: fetchImpl || (async () => { throw new Error('no network'); }),
    URL: URL, Blob: function () {},
    AbortController: AbortController,
  };
  if (storage !== false) {
    sandbox.localStorage = {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    };
  }
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'ground.js' });
  return sandbox;
}

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); };
};
const okResp = (status, retryAfter) => ({
  status, ok: status === 200,
  headers: { get: n => (n.toLowerCase() === 'retry-after' ? retryAfter : null) },
  json: async () => ({}), text: async () => '',
});

(async () => {
  console.log('— vpFetch: per-host spacing —');
  {
    const sb = makeSandbox(async () => okResp(200));
    const t0 = Date.now();
    await sb.vpFetch('https://api.crossref.org/works/10.1/x');
    await sb.vpFetch('https://api.crossref.org/works/10.1/y');
    const dt = Date.now() - t0;
    ok('same host spaced >= 900ms (gap=1000)', dt >= 900, dt + 'ms');
  }
  {
    const sb = makeSandbox(async () => okResp(200));
    const t0 = Date.now();
    await Promise.all([
      sb.vpFetch('https://api.crossref.org/works/a'),
      sb.vpFetch('https://api.datacite.org/dois/b'),
    ]);
    const dt = Date.now() - t0;
    ok('different hosts not blocked by each other', dt < 900, dt + 'ms');
  }

  console.log('— vpFetch: 429 backoff + give-up —');
  {
    let calls = 0;
    const sb = makeSandbox(async () => (++calls <= 2 ? okResp(429, '0') : okResp(200)));
    const r = await sb.vpFetch('https://api.crossref.org/works/10.1/z');
    ok('429 retried then succeeds', r.ok && calls === 3, 'calls=' + calls);
  }
  {
    let calls = 0;
    const sb = makeSandbox(async () => { calls++; return okResp(429, '0'); });
    const r = await sb.vpFetch('https://api.crossref.org/works/10.1/w');
    ok('persistent 429 gives up after 3 retries', r.status === 429 && calls === 4, 'calls=' + calls);
  }

  console.log('— persistent cache —');
  {
    const sb = makeSandbox();
    sb.vpCacheSet('meta', 'doi:10.1/x', { exists: true });
    const hit = sb.vpCacheGet('meta', 'doi:10.1/x');
    ok('roundtrip', hit && hit.exists === true);
    ok('miss returns null', sb.vpCacheGet('meta', 'doi:10.1/nope') === null);
  }
  {
    const sb = makeSandbox();
    // inject a stale entry directly
    const store = JSON.parse(sb.localStorage.getItem('veripaper-cache-v1') || '{}');
    store['meta|doi:10.1/old'] = { v: { exists: true }, t: Date.now() - 8 * 864e5 };
    sb.localStorage.setItem('veripaper-cache-v1', JSON.stringify(store));
    sb._vpCache = null; // force reload
    ok('stale entry (8d > 7d TTL) is a miss', sb.vpCacheGet('meta', 'doi:10.1/old') === null);
  }
  {
    const sb = makeSandbox(null, false); // no localStorage
    let threw = false;
    try {
      sb.vpCacheSet('meta', 'k', { a: 1 });
      threw = sb.vpCacheGet('meta', 'k') !== null;
    } catch (e) { threw = true; }
    ok('graceful without localStorage', !threw);
  }

  console.log('— abstract dedup —');
  {
    let netCalls = 0;
    const sb = makeSandbox(async (url) => {
      netCalls++;
      return { status: 200, ok: true, headers: { get: () => null },
        json: async () => ({ abstract: 'An abstract about transformers.' }) };
    });
    const runCache = new Map();
    const res = { doi: '10.1/dup', arxiv_id: null };
    const a1 = await sb.fetchAbstract(res, runCache);
    const a2 = await sb.fetchAbstract(res, runCache);
    ok('same DOI fetched once per run', netCalls === 1 && a1 === a2, 'netCalls=' + netCalls);
  }

  console.log('— ABSTRACT-SUPPORTED end to end —');
  {
    const sb = makeSandbox(async (url, init) => {
      if (url.includes('openrouter')) {
        return { status: 200, ok: true, headers: { get: () => null },
          json: async () => ({ choices: [{ message: { content: 'VERDICT: SUPPORTED\nREASON: Abstract states the key assertion.' } }] }) };
      }
      if (url.includes('crossref.org/works/10.1000')) {
        return { status: 200, ok: true, headers: { get: () => null },
          json: async () => ({ message: { title: ['A real paper'], author: [{ given: 'A', family: 'Smith' }],
            'container-title': ['J'], DOI: '10.1000/x' } }) };
      }
      if (url.includes('semanticscholar')) {
        return { status: 200, ok: true, headers: { get: () => null },
          json: async () => ({ abstract: 'This paper states the key assertion about X.' }) };
      }
      return { status: 404, ok: false, headers: { get: () => null }, json: async () => ({}) };
    });
    const ev = await sb.groundDraft(
      'Smith showed X [doi:10.1000/x].', { apiKey: 'test-key' }, null);
    ok('SUPPORTED verdict -> ABSTRACT-SUPPORTED',
      ev[0].base === 'ABSTRACT-SUPPORTED', ev[0].base + ' | ' + ev[0].note);
    ok('note says abstract-level', /abstract-level/i.test(ev[0].note), ev[0].note);
    const html = sb.renderReport(ev);
    ok('report counts ABSTRACT-SUPPORTED', /ABSTRACT-SUPPORTED 1/.test(html));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
