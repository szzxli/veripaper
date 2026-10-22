/* veripaper web regression: a network / HTTP failure is "not checked",
 * never "not found" — and so never FABRICATED.
 *
 * Before this fix the registry checks in web/ground.js and the single-ID
 * checker in web/index.html returned null ("no such record") for anything
 * that was not HTTP 200 or 429: offline, CORS, a timeout, a 5xx, a bot-check
 * page. A real DOI then came out FABRICATED whenever the network failed.
 * Only a genuine 404 (or an empty search result) is a miss now.
 *  1. verifyDoi / verifyArxiv: offline, 5xx, timeout, non-JSON, 429 -> limited
 *     (not checked); all-404 / empty EPMC result -> clean miss
 *  2. groundDraft: raw DOI / arXiv ID offline -> RATE_LIMITED with a
 *     "could not reach" note; all-404 -> still FABRICATED
 *  3. reference entry without an identifier, offline -> RATE_LIMITED, not
 *     UNVERIFIED "no match"; not cached, so the next online run checks it
 *  4. .bib mode offline -> no FABRICATED
 *  5. the homepage single-identifier checker (inline script in index.html)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeSandbox, resp, harness } = require('./_sandbox');
const { ok, done } = harness();

const offline = async () => { throw new TypeError('Failed to fetch'); };
const timeout = async () => { const e = new Error('The operation was aborted due to timeout'); e.name = 'TimeoutError'; throw e; };
const crossrefRecord = (title) => resp(200, { message: { title: [title], author: [{ given: 'K', family: 'He' }],
  'container-title': ['CVPR'], published: { 'date-parts': [[2016]] } } });

(async () => {
  console.log('— verifyDoi: failure is not checked, 404 is a miss —');
  {
    const v = await makeSandbox(offline).verifyDoi('10.1109/CVPR.2016.90');
    ok('offline -> exists false', v.exists === false);
    ok('offline -> limited (not checked)', v.limited === true, JSON.stringify(v));
    ok('offline -> unreachable flag', v.unreachable === true);
    ok('offline -> every registry listed as failed', (v.failed || []).length === 4, JSON.stringify(v.failed));
  }
  {
    const v = await makeSandbox(async (u) => u.includes('crossref') ? resp(500, {}) : resp(404, {})).verifyDoi('10.1109/CVPR.2016.90');
    ok('Crossref HTTP 500 + others 404 -> not checked', v.limited === true && v.unreachable === true, JSON.stringify(v));
    ok('...note data names Crossref HTTP 500', (v.failed || []).some(f => f.source === 'Crossref' && f.why === 'HTTP 500'), JSON.stringify(v.failed));
  }
  {
    const v = await makeSandbox(async (u) => u.includes('datacite') ? timeout() : resp(404, {})).verifyDoi('10.1/x');
    ok('DataCite timeout + others 404 -> not checked', v.limited === true && v.unreachable === true);
  }
  {
    const v = await makeSandbox(async (u) => u.includes('crossref') ? resp(200, '<html>bot check</html>') : resp(404, {})).verifyDoi('10.1/y');
    ok('Crossref non-JSON 200 -> not checked', v.limited === true);
  }
  {
    const v = await makeSandbox(async (u) => u.includes('crossref') ? resp(403, {}) : resp(404, {})).verifyDoi('10.1/z');
    ok('Crossref HTTP 403 (blocked) -> not checked', v.limited === true);
  }
  {
    const v = await makeSandbox(async () => resp(429, {}, { 'Retry-After': '3600' })).verifyDoi('10.1/rl');
    ok('429 everywhere -> limited, not "unreachable"', v.limited === true && v.unreachable === false, JSON.stringify(v));
  }
  {
    const v = await makeSandbox(async () => resp(404, {})).verifyDoi('10.9999/does-not-exist');
    ok('all registries 404 -> clean miss (exists false, limited false)', v.exists === false && v.limited === false, JSON.stringify(v));
  }
  {
    const v = await makeSandbox(async (u) => u.includes('europepmc') ? resp(200, { resultList: { result: [] } }) : resp(404, {}))
      .verifyDoi('10.9999/does-not-exist');
    ok('404s + empty Europe PMC result -> clean miss', v.exists === false && v.limited === false);
  }
  {
    const v = await makeSandbox(async (u) => u.includes('crossref') ? crossrefRecord('Deep Residual Learning') : offline())
      .verifyDoi('10.1109/CVPR.2016.90');
    ok('a hit still wins even if later sources would fail', v.exists === true && v.limited === false);
  }
  {
    const off = await makeSandbox(offline).verifyArxiv('1706.03762');
    ok('arXiv offline -> not checked', off.exists === false && off.limited === true && off.unreachable === true);
    const d5 = await makeSandbox(async () => resp(502, {})).verifyArxiv('1706.03762');
    ok('arXiv: DataCite 502 -> not checked', d5.limited === true);
    const miss = await makeSandbox(async () => resp(404, {})).verifyArxiv('2401.99999');
    ok('arXiv: DataCite 404 -> clean miss', miss.exists === false && miss.limited === false);
  }

  console.log('— not-checked results are not cached —');
  {
    let online = false;
    const sb = makeSandbox(async (u) => (!online ? offline() : u.includes('crossref') ? crossrefRecord('Deep Residual Learning') : resp(404, {})));
    const a = await sb.verifyDoi('10.1109/CVPR.2016.90');
    online = true;
    const b = await sb.verifyDoi('10.1109/CVPR.2016.90');
    ok('offline result not cached: next online check finds the DOI', a.limited === true && b.exists === true, JSON.stringify([a.limited, b.exists]));
  }

  console.log('— groundDraft labels —');
  const md = '# T\n\nResidual networks ease training 10.1109/CVPR.2016.90. Attention suffices arXiv:1706.03762.';
  {
    const ev = await makeSandbox(offline).groundDraft(md, {}, null);
    ok('two findings', ev.length === 2, String(ev.length));
    ok('offline: no FABRICATED', ev.every(e => e.base !== 'FABRICATED'), JSON.stringify(ev.map(e => e.base)));
    ok('offline: RATE_LIMITED (not checked)', ev.every(e => e.base === 'RATE_LIMITED'));
    ok('offline: note says could not reach / not checked / NOT proven fake',
      ev.every(e => /could not reach the registries/.test(e.note) && /not checked/.test(e.note) && /NOT proven fake/.test(e.note)), ev.map(e => e.note).join(' || '));
    ok('offline: note does not blame a rate limit', ev.every(e => !/HTTP 429/.test(e.note)));
  }
  {
    const ev = await makeSandbox(async () => resp(500, {})).groundDraft(md, {}, null);
    ok('5xx everywhere: no FABRICATED', ev.every(e => e.base === 'RATE_LIMITED'), JSON.stringify(ev.map(e => e.base)));
  }
  {
    const ev = await makeSandbox(async () => resp(404, {})).groundDraft(md, {}, null);
    ok('all 404: invented identifiers still FABRICATED', ev.every(e => e.base === 'FABRICATED'), JSON.stringify(ev.map(e => e.base)));
  }

  console.log('— reference entry without an identifier —');
  {
    const md2 = '# T\n\nA claim [1].\n\n## References\n\n[1] He, K., Zhang, X. Deep residual learning for image recognition. CVPR 2016.';
    let online = false;
    const sb = makeSandbox(async (u) => {
      if (!online) return offline();
      if (u.includes('api.crossref.org/works?')) return resp(200, { message: { items: [{ DOI: '10.1109/CVPR.2016.90',
        title: ['Deep residual learning for image recognition'], published: { 'date-parts': [[2016]] } }] } });
      if (u.includes('api.crossref.org/works/')) return crossrefRecord('Deep residual learning for image recognition');
      return resp(404, {});
    });
    const ev = await sb.groundDraft(md2, {}, null);
    ok('offline: RATE_LIMITED, not UNVERIFIED', ev[0] && ev[0].base === 'RATE_LIMITED', ev[0] && (ev[0].base + ' :: ' + ev[0].note));
    ok('offline: note says the sources could not be asked', ev[0] && /could not be asked/.test(ev[0].note) && /unreachable/.test(ev[0].note), ev[0] && ev[0].note);
    online = true;
    const ev2 = await sb.groundDraft(md2, {}, null);
    ok('offline miss not cached: online run finds it (CITED)', ev2[0] && ev2[0].base === 'CITED', ev2[0] && (ev2[0].base + ' :: ' + ev2[0].note));
  }
  {
    const md3 = '# T\n\nA claim [1].\n\n## References\n\n[1] Anonymous. A title no database knows at all. 2020.';
    const empty = async (u) => {
      if (u.includes('crossref')) return resp(200, { message: { items: [] } });
      if (u.includes('datacite')) return resp(200, { data: [] });
      if (u.includes('openalex')) return resp(200, { results: [] });
      if (u.includes('dblp')) return resp(200, { result: { hits: {} } });
      if (u.includes('semanticscholar')) return resp(200, { total: 0, data: [] });
      return resp(404, {});
    };
    const ev = await makeSandbox(empty).groundDraft(md3, {}, null);
    ok('every index answers with an empty result -> UNVERIFIED (clean answers)', ev[0] && ev[0].base === 'UNVERIFIED', ev[0] && ev[0].base);
  }

  console.log('— .bib mode offline —');
  {
    const bibSrc = fs.readFileSync(path.join(__dirname, '..', 'bibtex.js'), 'utf8');
    const sb = makeSandbox(offline);
    vm.runInContext(bibSrc, sb, { filename: 'bibtex.js' });
    const bib = '@article{he2016, title={Deep Residual Learning}, author={He, Kaiming}, year={2016}, doi={10.1109/CVPR.2016.90}}\n' +
      '@misc{v2017, title={Attention Is All You Need}, author={Vaswani, Ashish}, year={2017}, eprint={1706.03762}, archivePrefix={arXiv}}';
    const dd = sb.bibToDraft(bib);
    const ev = sb.bibLabelEvidence(await sb.groundDraft(dd.draft, { bibMode: true }, null), dd.entries);
    ok('.bib offline: 2 entries, none FABRICATED', ev.length === 2 && ev.every(e => e.base === 'RATE_LIMITED'), JSON.stringify(ev.map(e => e.label)));
  }

  console.log('— homepage single-identifier checker (index.html inline script) —');
  {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    const inline = scripts.find(s => s.includes("getElementById('doi-input')"));
    ok('inline checker script found', !!inline);
    async function runChecker(input, fetchImpl) {
      const els = {};
      const el = (id) => (els[id] = els[id] || { value: '', innerHTML: '', textContent: '', disabled: false, addEventListener(t, f) { this['on' + t] = f; } });
      const sb = { console, navigator: {}, document: { getElementById: el }, fetch: async (u, i) => fetchImpl(String(u), i), URLSearchParams,
        DOMParser: function () { this.parseFromString = () => ({ querySelector: () => null }); } };
      vm.createContext(sb);
      vm.runInContext(inline, sb, { filename: 'index-inline.js' });
      el('doi-input').value = input;
      await el('doi-btn').onclick();
      return el('verify-result').innerHTML;
    }
    const off = await runChecker('10.1109/CVPR.2016.90', offline);
    ok('offline DOI: not FABRICATED', !/FABRICATED/.test(off), off);
    ok('offline DOI: says not checked', /not checked/i.test(off) && /NOT proven fake/.test(off), off);
    const offA = await runChecker('1706.03762', offline);
    ok('offline arXiv ID: not FABRICATED, not checked', !/FABRICATED/.test(offA) && /not checked/i.test(offA), offA);
    const e5 = await runChecker('10.1109/CVPR.2016.90', async (u) => u.includes('crossref') ? resp(503, {}) : resp(404, {}));
    ok('Crossref 503 + others 404: not FABRICATED', !/FABRICATED/.test(e5) && /not checked/i.test(e5), e5);
    const e500 = await runChecker('10.1109/CVPR.2016.90', async (u) => u.includes('europepmc') ? resp(500, {}) : resp(404, {}));
    ok('Europe PMC 500 + others 404: not FABRICATED', !/FABRICATED/.test(e500) && /Europe PMC \(HTTP 500\)/.test(e500), e500);
    const fab = await runChecker('10.9999/invented.2024', async (u) => u.includes('europepmc') ? resp(200, { resultList: { result: [] } }) : resp(404, {}));
    ok('genuine 404s + empty search: FABRICATED', /FABRICATED/.test(fab), fab);
    const real = await runChecker('10.1109/CVPR.2016.90', async (u) => u.includes('crossref') ? crossrefRecord('Deep Residual Learning for Image Recognition') : resp(404, {}));
    ok('real DOI: CITED', /CITED/.test(real) && /Deep Residual Learning/.test(real), real);
  }

  done();
})();
