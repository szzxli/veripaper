/* veripaper web: malformed DOI-like strings are flagged INVALID_DOI
 * (never silently ignored) in groundDraft, .bib mode and the homepage checker. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeSandbox, resp, harness } = require('./_sandbox');
const { ok, done } = harness();
const notFound = async () => resp(404, {});

(async () => {
  {
    const sb = makeSandbox(notFound);
    ok('findInvalidDois', JSON.stringify(sb.findInvalidDois('a 10.1/x b doi:10.12/ab c 10.1234/ok 10.5/2')) === '["10.12/ab"]');
    const ev = await sb.groundDraft('Transformers beat RNNs (doi:10.1/x).\n\nRatio 10.5/2 holds.\n\nSee https://doi.org/10.22/bad for more.\n', {}, null);
    ok('text: INVALID_DOI for both', ev.length === 2 && ev.every(e => e.base === 'INVALID_DOI'), JSON.stringify(ev.map(e => e.base)));
    ok('text: note says DOI format invalid', /DOI format invalid/.test(ev[0].note));
    ok('report counts INVALID_DOI', /INVALID_DOI 2/.test(sb.renderReport(ev)));
  }
  {
    const sb = makeSandbox(notFound);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'bibtex.js'), 'utf8'), sb, { filename: 'bibtex.js' });
    const dd = sb.bibToDraft('@article{a, title={T}, author={Doe, J.}, year={2020}, doi={10.1/x}}');
    const ev = sb.bibLabelEvidence(await sb.groundDraft(dd.draft, { bibMode: true }, null), dd.entries);
    ok('.bib: INVALID_DOI', ev.length === 1 && ev[0].base === 'INVALID_DOI', JSON.stringify(ev.map(e => e.label)));
  }
  {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes("getElementById('doi-input')"));
    let calls = 0;
    async function run(input) {
      const els = {};
      const el = (id) => (els[id] = els[id] || { value: '', innerHTML: '', textContent: '', disabled: false, addEventListener(t, f) { this['on' + t] = f; } });
      const sb = { console, navigator: {}, document: { getElementById: el }, fetch: async () => { calls++; return resp(404, {}); }, URLSearchParams,
        DOMParser: function () { this.parseFromString = () => ({ querySelector: () => null }); } };
      vm.createContext(sb);
      vm.runInContext(inline, sb);
      el('doi-input').value = input;
      await el('doi-btn').onclick();
      return el('verify-result').innerHTML;
    }
    for (const x of ['10.1/x', 'doi:10.1/x', 'https://doi.org/10.12/ab']) {
      const h = await run(x);
      ok('homepage ' + x + ' -> INVALID_DOI', /INVALID_DOI/.test(h) && !/FABRICATED/.test(h), h);
    }
    ok('homepage: invalid DOI not looked up', calls === 0, String(calls));
    ok('homepage: valid DOI still checked', /FABRICATED/.test(await run('10.9999/invented.2024')));
  }
  done();
})();
