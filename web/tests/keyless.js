/* veripaper web regression: keyless claim-support mode (no LLM key) —
 * 1. lazy loading: the NLI library is NOT loaded at startup, only on the
 *    first claim with an abstract, and only once for many claims
 * 2. high entailment -> ABSTRACT-SUPPORTED [KEYLESS-NLI], note says
 *    "small NLI model, abstract only"
 * 3. deterministic specifics check wins over the model:
 *    numbers absent from the abstract -> [SPECIFIC-NOT-IN-ABSTRACT]
 * 4. high contradiction -> CITED, no contradiction verdict (small NLI
 *    models over-call it); a contradictory window blocks SUPPORTED
 * 4b. chimeric / retracted never stay ABSTRACT-SUPPORTED; [KEYLESS-NLI]
 *    tag dropped when the verdict is downgraded
 * 5. missing named entity blocks a keyless SUPPORTED
 * 6. model fails to load -> CITED + overlap hint, deterministic check
 *    still runs, nothing crashes
 * 7. keyless:false -> model never loaded; BYOK key -> LLM path, no model
 * 8. claimForNli strips citation markers; UI checkbox present + default on,
 *    transformers.js not in a <script> tag (lazy)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { makeSandbox, resp, harness } = require('./_sandbox');
const { ok, done } = harness();

const ABSTRACT = 'Deeper neural networks are more difficult to train. We present a residual learning framework to ease the training of networks that are substantially deeper than those used previously. On the ImageNet dataset we evaluate residual nets with a depth of up to 152 layers. An ensemble of these residual nets achieves 3.57% error on the ImageNet test set.';

/* Fake transformers.js: entailment/contradiction decided by test rules on the
 * hypothesis text. Records how often it was loaded / run. */
function fakeLib(rules, stats) {
  const decide = hyp => {
    for (const [re, probs] of rules) if (re.test(hyp)) return probs;
    return [0.1, 0.1, 0.8];
  };
  return async () => {
    stats.loads++;
    const tok = (prem, o) => ({ prem: prem[0], hyp: o.text_pair[0] });
    const model = async (inp) => {
      stats.runs++; stats.hyps.push(inp.hyp);
      const [c, e, n] = decide(inp.hyp);   // label order of nli-deberta-v3: 0=contradiction 1=entailment 2=neutral
      return { logits: { data: [Math.log(c), Math.log(e), Math.log(n)] } };
    };
    model.config = { id2label: { 0: 'contradiction', 1: 'entailment', 2: 'neutral' } };
    return {
      env: {},
      AutoTokenizer: { from_pretrained: async () => tok },
      AutoModelForSequenceClassification: { from_pretrained: async (name, o) => { stats.model = name; stats.dtype = o && o.dtype; return model; } },
    };
  };
}
function registryFetch(extra) {
  return async (url, init) => {
    if (extra) { const r = await extra(url, init); if (r) return r; }
    if (url.includes('api.crossref.org/works/10.1109')) return resp(200, { message: {
      title: ['Deep Residual Learning for Image Recognition'], author: [{ given: 'Kaiming', family: 'He' }],
      'container-title': ['CVPR'], published: { 'date-parts': [[2016]] } } });
    if (url.includes('api.openalex.org/works/doi:')) {
      const inv = {};
      ABSTRACT.split(' ').forEach((w, i) => { (inv[w] = inv[w] || []).push(i); });
      return resp(200, { id: 'W1', title: 'Deep Residual Learning for Image Recognition', abstract_inverted_index: inv });
    }
    if (url.includes('api.openalex.org/works/https://doi.org/')) return resp(200, { id: 'W1', referenced_works: [] });
    return resp(404, {});
  };
}
const DRAFT = c => c + ' (10.1109/CVPR.2016.90).';

(async () => {
  console.log('— lazy loading —');
  {
    const stats = { loads: 0, runs: 0, hyps: [] };
    const sb = makeSandbox(registryFetch(), { nliLoader: fakeLib([], stats) });
    ok('library not loaded at startup', stats.loads === 0);
    await sb.groundDraft('No citations here at all.', {}, null);
    ok('not loaded for a draft without citations', stats.loads === 0);
    const ev = await sb.groundDraft(
      'Residual learning eases training (10.1109/CVPR.2016.90). Deeper networks are harder to train (10.1109/CVPR.2016.90). Residual nets go to 152 layers (10.1109/CVPR.2016.90).', {}, null);
    ok('loaded exactly once for three claims', stats.loads === 1, 'loads=' + stats.loads);
    ok('uses nli-deberta-v3-xsmall, quantized', stats.model === 'Xenova/nli-deberta-v3-xsmall' && stats.dtype === 'q8', stats.model + ' ' + stats.dtype);
    ok('three evidence rows', ev.length === 3);
    ok('model saw the claim without the DOI marker', stats.hyps.every(h => !/10\.1109/.test(h)), stats.hyps[0]);
  }

  console.log('— supported / contradicted / specifics —');
  {
    const stats = { loads: 0, runs: 0, hyps: [] };
    const sb = makeSandbox(registryFetch(), { nliLoader: fakeLib([
      [/eases the training/, [0.01, 0.97, 0.02]],
      [/harder to optimize/, [0.95, 0.01, 0.04]],
      [/94\.8%/, [0.01, 0.97, 0.02]],          // model fooled; deterministic check must catch it
      [/CIFAR/, [0.01, 0.97, 0.02]],
    ], stats) });
    const ev1 = await sb.groundDraft(DRAFT('Residual learning eases the training of substantially deeper networks'), {}, null);
    ok('high entailment -> ABSTRACT-SUPPORTED', ev1[0].base === 'ABSTRACT-SUPPORTED', ev1[0].base + ' | ' + ev1[0].note);
    ok('tagged [KEYLESS-NLI]', /\[KEYLESS-NLI\]/.test(ev1[0].label), ev1[0].label);
    ok('note is honest: small model, abstract only', /small NLI model, abstract only/.test(ev1[0].note) && /less accurate than the LLM mode/.test(ev1[0].note), ev1[0].note);

    const ev2 = await sb.groundDraft(DRAFT('Residual networks are harder to optimize than plain networks'), {}, null);
    ok('contradiction -> CITED, no "contradicted" verdict (small models over-call it)',
      ev2[0].base === 'CITED' && !/CONTRADICT/.test(ev2[0].label) && /does not clearly support/.test(ev2[0].note), ev2[0].label + ' | ' + ev2[0].note);

    const ev3 = await sb.groundDraft(DRAFT('A single ResNet-50 reaches 94.8% top-5 accuracy on ImageNet'), {}, null);
    ok('missing number -> [SPECIFIC-NOT-IN-ABSTRACT] even if the model says entail',
      /\[SPECIFIC-NOT-IN-ABSTRACT\]/.test(ev3[0].label) && ev3[0].base === 'CITED', ev3[0].label + ' | ' + ev3[0].note);
    ok('note says deterministic + shows the specific', /Deterministic check/.test(ev3[0].note) && /94\.8%/.test(ev3[0].note), ev3[0].note);
    ok('never ABSTRACT-SUPPORTED with missing specifics', !/KEYLESS-NLI/.test(ev3[0].label));
  }
  {
    const stats = { loads: 0, runs: 0, hyps: [] };
    const sb = makeSandbox(registryFetch(), { nliLoader: fakeLib([[/./, [0.01, 0.97, 0.02]]], stats) });
    const ev = await sb.groundDraft(DRAFT('Residual nets trained on CoLaNet ease the training of deeper networks'), {}, null);
    ok('missing named entity blocks keyless SUPPORTED', ev[0].base === 'CITED' && /CoLaNet/.test(ev[0].note), ev[0].base + ' | ' + ev[0].note);
  }

  console.log('— downgrades: chimeric / retracted / contradictory window —');
  {
    const stats = { loads: 0, runs: 0, hyps: [] };
    const sb = makeSandbox(registryFetch(async (url) => url.includes('api.crossref.org/works/10.1109') ? resp(200, { message: {
      title: ['RETRACTED: Deep Residual Learning for Image Recognition'], author: [{ given: 'Kaiming', family: 'He' }] } }) : null),
      { nliLoader: fakeLib([[/./, [0.01, 0.97, 0.02]]], stats) });
    const ev = await sb.groundDraft(DRAFT('Residual learning eases the training of deeper networks'), {}, null);
    ok('retracted + entail -> CITED [RETRACTED], no [KEYLESS-NLI]', ev[0].base === 'CITED' && /\[RETRACTED\]/.test(ev[0].label) && !/KEYLESS-NLI/.test(ev[0].label), ev[0].label);
  }
  {
    const stats = { loads: 0, runs: 0, hyps: [] };
    const sb = makeSandbox(registryFetch(async (url) => {
      if (url.includes('api.crossref.org/works?')) return resp(200, { message: { items: [{ DOI: '10.1109/CVPR.2016.90',
        title: ['Deep Residual Learning for Image Recognition'], published: { 'date-parts': [[2016]] } }] } });
      return null;
    }), { nliLoader: fakeLib([[/./, [0.01, 0.97, 0.02]]], stats) });
    const ev = await sb.groundDraft('Residual learning eases the training of deeper networks [1].\n\n## References\n[1] Garcia, M., et al. Deep residual learning for image recognition. CVPR 2016.', {}, null);
    ok('chimeric + entail -> CITED [CHIMERIC], no [KEYLESS-NLI]', ev[0].base === 'CITED' && /CHIMERIC/.test(ev[0].label) && !/KEYLESS-NLI/.test(ev[0].label), ev[0].label);
  }
  {
    // best window entails, another window strongly contradicts -> not SUPPORTED
    const stats = { loads: 0, runs: 0, hyps: [] };
    let i = 0;
    const lib = async () => {
      const T = await fakeLib([], stats)();
      const m = async () => { i++; return { logits: { data: i % 2 ? [Math.log(0.01), Math.log(0.97), Math.log(0.02)] : [Math.log(0.9), Math.log(0.05), Math.log(0.05)] } }; };
      m.config = { id2label: { 0: 'contradiction', 1: 'entailment', 2: 'neutral' } };
      T.AutoModelForSequenceClassification = { from_pretrained: async () => m };
      return T;
    };
    const sb = makeSandbox(registryFetch(), { nliLoader: lib });
    const ev = await sb.groundDraft(DRAFT('Residual learning eases the training of deeper networks'), {}, null);
    ok('a strongly contradictory window blocks keyless SUPPORTED', ev[0].base === 'CITED', ev[0].base + ' | ' + ev[0].note);
    ok('...and the note says the signal is mixed', /mixed signal/.test(ev[0].note), ev[0].note);
  }

  console.log('— model unavailable / off / BYOK —');
  {
    const sb = makeSandbox(registryFetch(), { nliLoader: async () => { throw new Error('offline'); } });
    const ev = await sb.groundDraft(DRAFT('Residual learning eases the training of substantially deeper networks'), {}, null);
    ok('load failure -> CITED, no crash', ev[0].base === 'CITED', ev[0].base);
    ok('note says model unavailable + keyword overlap number', /in-browser model unavailable/.test(ev[0].note) && /keyword overlap/.test(ev[0].note), ev[0].note);
    const ev2 = await sb.groundDraft(DRAFT('ResNet reaches 94.8% top-5 accuracy'), {}, null);
    ok('deterministic check still runs without the model', /\[SPECIFIC-NOT-IN-ABSTRACT\]/.test(ev2[0].label), ev2[0].label);
  }
  {
    // no window.vpNliLoader: the browser path is a dynamic import from the CDN;
    // in this sandbox it cannot run, and that must degrade, not throw
    const sb = makeSandbox(registryFetch());
    const ev = await sb.groundDraft(DRAFT('Residual learning eases the training of deeper networks'), {}, null);
    ok('CDN import failure degrades to CITED', ev[0].base === 'CITED', ev[0].base + ' | ' + ev[0].note);
    const lib = require('vm').runInContext('VP_NLI.lib', sb);
    ok('CDN pinned to a fixed transformers.js version', /@huggingface\/transformers@\d+\.\d+\.\d+\//.test(lib), lib);
  }
  {
    const stats = { loads: 0, runs: 0, hyps: [] };
    const sb = makeSandbox(registryFetch(), { nliLoader: fakeLib([[/./, [0.01, 0.97, 0.02]]], stats) });
    const ev = await sb.groundDraft(DRAFT('Residual learning eases the training of deeper networks'), { keyless: false }, null);
    ok('keyless:false -> model never loaded', stats.loads === 0 && ev[0].base === 'CITED', ev[0].note);
    ok('...note says the model is off', /in-browser model off/.test(ev[0].note), ev[0].note);
  }
  {
    const stats = { loads: 0, runs: 0, hyps: [] };
    const sb = makeSandbox(registryFetch(async (url) => url.includes('openrouter')
      ? resp(200, { choices: [{ message: { content: 'VERDICT: SUPPORTED\nREASON: The abstract states it.' } }] }) : null),
      { nliLoader: fakeLib([[/./, [0.01, 0.97, 0.02]]], stats) });
    const ev = await sb.groundDraft(DRAFT('Residual learning eases the training of deeper networks'), { apiKey: 'k' }, null);
    ok('BYOK key -> LLM path, no model download', stats.loads === 0 && ev[0].base === 'ABSTRACT-SUPPORTED' && !/KEYLESS/.test(ev[0].label), ev[0].label);
  }

  console.log('— helpers + UI —');
  {
    const sb = makeSandbox();
    ok('claimForNli strips DOI with parens', sb.claimForNli('A report linked X with Y (10.1016/S0140-6736(97)11096-0).') === 'A report linked X with Y.', sb.claimForNli('A report linked X with Y (10.1016/S0140-6736(97)11096-0).'));
    ok('claimForNli strips arXiv + [n]', sb.claimForNli('BERT is bidirectional (arXiv:1810.04805) [1, 2].') === 'BERT is bidirectional.', sb.claimForNli('BERT is bidirectional (arXiv:1810.04805) [1, 2].'));
    ok('claimForNli strips author-year', sb.claimForNli('Deep learning works (LeCun et al., 2015).') === 'Deep learning works.', sb.claimForNli('Deep learning works (LeCun et al., 2015).'));
    ok('entities found', JSON.stringify(sb.extractEntities('RoBERTa on CoLA beats ResNet-50')) === JSON.stringify(['RoBERTa', 'CoLA', 'ResNet-50']));
    ok('NLI windows: whole abstract + 2-sentence windows', sb.nliWindows(ABSTRACT).length >= 3 && sb.nliWindows(ABSTRACT)[0] === ABSTRACT);
  }
  {
    const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    ok('keyless checkbox present and checked by default', /id="ground-keyless" type="checkbox" checked/.test(html));
    ok('UI labels it honestly (abstract only, smaller model)', /abstract only/.test(html) && /less accurate than an LLM/.test(html));
    ok('transformers.js not loaded eagerly', !/<script[^>]+transformers/.test(html));
  }
  done();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
