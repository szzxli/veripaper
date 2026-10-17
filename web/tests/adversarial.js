/* veripaper web regression: v20 adversarial set —
 * Attack cases the pipeline must survive (mocked network):
 *  A1 paraphrased deception: specifics missing from abstract, found in a
 *     paper B cites -> CITED + [POSSIBLE-MISATTRIBUTION] (not SUPPORTED)
 *  A2 thin support: hard numbers absent from abstract, no chain hit ->
 *     CITED + [SPECIFIC-NOT-IN-ABSTRACT]
 *  A3 clean claim: no hard specifics -> ABSTRACT-SUPPORTED, no extra tags
 *     (the backstop must not fire on ordinary claims)
 *  A4 number formatting: "1.2M" vs "1.2 million" must NOT false-flag
 *  A5 judge prompt hardening: the system prompt treats the claim as
 *     untrusted data (injection-resistance clause present)
 *  A6 extractSpecifics unit cases
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
function makeSandbox(fetchImpl) {
  const store = {};
  const sandbox = {
    console,
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id),
    document: {
      readyState: 'complete', addEventListener: () => {},
      getElementById: () => mkEl(), createElement: () => mkEl(), body: mkEl(),
    },
    window: {}, navigator: {}, location: { href: '' },
    fetch: fetchImpl,
    URL: URL, URLSearchParams: URLSearchParams, Blob: function () {},
    AbortController: AbortController,
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'ground.js' });
  return sandbox;
}

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); };
};
const J = obj => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => obj });

/* Mock world: paper 10.1000/victim exists; its abstract is vague.
 * Its OpenAlex chain cites 10.1000/origin "Contrastive Pretraining at Scale". */
function mockWorld(judgeVerdict, chainRefs) {
  let lastJudgeBody = null;
  const fetchImpl = async (url, init) => {
    if (url.includes('openrouter.ai')) {
      lastJudgeBody = JSON.parse(init.body);
      return J({ choices: [{ message: {
        content: `VERDICT: ${judgeVerdict}\nREASON: Mocked judge.` } }] });
    }
    if (url.includes('api.openalex.org/works/https')) {
      return J({ referenced_works: ['https://openalex.org/W111'] });
    }
    if (url.includes('api.openalex.org/works?')) {
      return J({ results: chainRefs || [] });
    }
    if (url.includes('crossref.org/works/')) {
      return J({ message: { title: ['A Study of Contrastive Methods'],
        author: [{ given: 'J', family: 'Jones' }], 'container-title': ['Proc X'],
        DOI: '10.1000/victim' } });
    }
    if (url.includes('semanticscholar.org')) {
      return J({ abstract: 'We study contrastive methods for representation learning at scale.' });
    }
    return { status: 404, ok: false, headers: { get: () => null }, json: async () => ({}) };
  };
  const sb = makeSandbox(fetchImpl);
  return { sb, getJudgeBody: () => lastJudgeBody };
}

(async () => {
  console.log('— A1: paraphrased deception via citation chain —');
  {
    const { sb } = mockWorld('SUPPORTED',
      [{ title: 'Contrastive Pretraining at Scale', doi: '10.1000/origin' }]);
    const ev = await sb.groundDraft(
      'The "contrastive pretraining" method reaches 95.2% accuracy [doi:10.1000/victim].',
      { apiKey: 'k' }, null);
    ok('fooled judge does NOT yield ABSTRACT-SUPPORTED', ev[0].base === 'CITED', ev[0].base);
    ok('tags POSSIBLE-MISATTRIBUTION', ev[0].label.includes('[POSSIBLE-MISATTRIBUTION]'), ev[0].label);
    ok('note names the cited origin', /Contrastive Pretraining at Scale/.test(ev[0].note), ev[0].note.slice(0, 120));
  }

  console.log('— A2: thin support, no chain hit —');
  {
    const { sb } = mockWorld('SUPPORTED', [{ title: 'Unrelated Work on Kernels', doi: '10.1000/other' }]);
    const ev = await sb.groundDraft(
      'Our method cuts error by 37.5% [doi:10.1000/victim].',
      { apiKey: 'k' }, null);
    ok('downgraded to CITED', ev[0].base === 'CITED', ev[0].base);
    ok('tags SPECIFIC-NOT-IN-ABSTRACT', ev[0].label.includes('[SPECIFIC-NOT-IN-ABSTRACT]'), ev[0].label);
  }

  console.log('— A3: clean claim, no false positive —');
  {
    const { sb } = mockWorld('SUPPORTED', []);
    const ev = await sb.groundDraft(
      'Contrastive methods improved representation learning [doi:10.1000/victim].',
      { apiKey: 'k' }, null);
    ok('stays ABSTRACT-SUPPORTED', ev[0].base === 'ABSTRACT-SUPPORTED', ev[0].base);
    ok('no extra tags', !/MISATTRIBUTION|SPECIFIC-NOT/.test(ev[0].label), ev[0].label);
  }

  console.log('— A4: number formatting robustness —');
  {
    const { sb } = mockWorld('SUPPORTED', []);
    // abstract says "1.2 million", claim says "1.2M" — must match after normalization
    const missing = sb.specificsMissingFromAbstract(
      'The dataset has 1.2M examples [doi:10.1000/victim].',
      'We release a dataset of 1.2 million examples.');
    ok('"1.2M" matches "1.2 million"', missing.length === 0, JSON.stringify(missing));
  }

  console.log('— A5: judge prompt treats claim as untrusted —');
  {
    const { sb, getJudgeBody } = mockWorld('SUPPORTED', []);
    await sb.groundDraft('Some claim [doi:10.1000/victim].', { apiKey: 'k' }, null);
    const sys = getJudgeBody().messages[0].content;
    ok('system prompt has untrusted-data clause', /untrusted data/i.test(sys));
    ok('system prompt names injection patterns', /ignore previous instructions/i.test(sys));
  }

  console.log('— A6: extractSpecifics units —');
  {
    const { sb } = mockWorld('SUPPORTED', []);
    const t1 = sb.extractSpecifics('Model achieves 23.4% on GLUE with p<0.01.');
    ok('numbers extracted', t1.includes('23.4%') && t1.some(s => /p<0\.01/.test(s)), JSON.stringify(t1));
    const t2 = sb.extractSpecifics('We use "exact quoted phrase" here.');
    ok('quoted phrase extracted', t2.includes('exact quoted phrase'), JSON.stringify(t2));
    const t3 = sb.extractSpecifics('Using BERT embeddings for the task.');
    ok('acronym extracted', t3.includes('BERT'), JSON.stringify(t3));
    const t4 = sb.extractSpecifics('In 2023, Smith published a paper.');
    ok('plain year not a specific', t4.length === 0, JSON.stringify(t4));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
