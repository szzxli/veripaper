/* veripaper regression: honesty upgrades —
 * 1. RATE_LIMITED is distinct from UNVERIFIED (429 != not-found)
 * 2. chimeric detection (real title + wrong authors)
 * 3. retraction flag ([RETRACTED], caps VERIFIED)
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
  const sandbox = {
    console,
    // real timers: ground.js awaits sleep() between claims
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id),
    document: {
      readyState: 'complete', addEventListener: () => {},
      getElementById: () => mkEl(), createElement: () => mkEl(), body: mkEl(),
    },
    window: {}, navigator: {}, location: { href: '' },
    fetch: fetchImpl || (async () => { throw new Error('no network'); }),
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    Blob: function () {},
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

(async () => {
  const sb = makeSandbox();
  const { detectChimeric, isRetractedTitle, renderReport, verifyDoi, resolveCitation, parseReferences, cleanDoi } = sb;

  console.log('— DOI cleaning (balanced parens kept) —');
  ok('wiley DOI with parens kept', cleanDoi('10.1016/S0140-6736(97)11096-0.') === '10.1016/S0140-6736(97)11096-0');
  ok('unbalanced trailing paren stripped', cleanDoi('10.1000/xyz)') === '10.1000/xyz');
  ok('trailing period stripped', cleanDoi('10.48550/arXiv.1706.03762.') === '10.48550/arXiv.1706.03762');

  console.log('— chimeric detection —');
  const REAL = ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar', 'Jakob Uszkoreit'];
  ok('chimeric entry flagged',
    detectChimeric('[1] Smith, J. Attention is all you need. NeurIPS 2017.', REAL));
  ok('correct entry not flagged',
    !detectChimeric('[1] Vaswani, A., et al. Attention is all you need. NeurIPS 2017.', REAL));
  ok('author-less entry not flagged',
    !detectChimeric('[1] Attention is all you need. NeurIPS 2017.', REAL));
  ok('empty authors not flagged',
    !detectChimeric('[1] Smith, J. Attention is all you need.', []));

  console.log('— retraction signal —');
  ok('retracted title detected', isRetractedTitle('RETRACTED: Ileal-lymphoid-nodular hyperplasia'));
  ok('normal title not retracted', !isRetractedTitle('Attention is all you need'));
  ok('null title not retracted', !isRetractedTitle(null));

  console.log('— 429 is not not-found —');
  const sb429 = makeSandbox(async () => ({ ok: false, status: 429 }));
  const v429 = await sb429.verifyDoi('10.1145/3377811.3380366');
  ok('429 -> exists false', v429.exists === false);
  ok('429 -> limited true', v429.limited === true);

  console.log('— retracted DOI through verifyDoi —');
  const sbRetr = makeSandbox(async (url) => {
    if (String(url).includes('crossref')) return {
      ok: true, status: 200,
      json: async () => ({ message: {
        title: ['RETRACTED: Ileal-lymphoid-nodular hyperplasia'],
        author: [{ given: 'A', family: 'Wakefield' }],
        'container-title': ['Lancet'], published: { 'date-parts': [[1998]] },
      } }),
    };
    return { ok: false, status: 404 };
  });
  const vr = await sbRetr.verifyDoi('10.1016/S0140-6736(97)11096-0');
  ok('retracted DOI exists', vr.exists === true);
  ok('retracted flag set', vr.retracted === true);
  ok('authors extracted', JSON.stringify(vr.authors) === JSON.stringify(['A Wakefield']));

  console.log('— resolveCitation threads all three —');
  const md = '# T\n\nClaim [1]. Claim two [2].\n\n## References\n\n' +
    '[1] Smith, J. Attention is all you need. NeurIPS 2017. arXiv:1706.03762.\n\n' +
    '[2] Wakefield, A. Ileal-lymphoid-nodular hyperplasia. Lancet 1998. doi:10.1016/S0140-6736(97)11096-0.';
  const sbFull = makeSandbox(async (url) => {
    const u = String(url);
    if (u.includes('datacite') && u.includes('arXiv.1706.03762')) return {
      ok: true, status: 200,
      json: async () => ({ data: { attributes: {
        titles: [{ title: 'Attention is all you need' }],
        creators: [{ name: 'Vaswani, Ashish' }, { name: 'Shazeer, Noam' }],
        publisher: 'arXiv', publicationYear: 2017 } } }),
    };
    if (u.includes('crossref') && u.includes('10.1016')) return {
      ok: true, status: 200,
      json: async () => ({ message: {
        title: ['RETRACTED: Ileal-lymphoid-nodular hyperplasia'],
        author: [{ given: 'A', family: 'Wakefield' }],
        'container-title': ['Lancet'] } }),
    };
    return { ok: false, status: 404 };
  });
  const refmap = sbFull.parseReferences(md);
  const c1 = await sbFull.resolveCitation({ cite_type: 'numeric', cite_id: '1' }, refmap, new Map());
  ok('[1] exists (real arXiv)', c1.exists === true);
  ok('[1] chimeric flagged (Smith vs Vaswani)', c1.chimeric === true, JSON.stringify({chimeric: c1.chimeric}));
  const c2 = await sbFull.resolveCitation({ cite_type: 'numeric', cite_id: '2' }, refmap, new Map());
  ok('[2] retracted flagged', c2.retracted === true);
  ok('[2] not chimeric (Wakefield matches)', c2.chimeric === false);

  console.log('— renderReport counts new labels —');
  const html = renderReport([
    { claim: 'a', base: 'RATE_LIMITED', label: 'RATE_LIMITED', note: 'x' },
    { claim: 'b', base: 'CITED', label: 'CITED [RETRACTED]', note: 'y' },
    { claim: 'c', base: 'CITED', label: 'CITED [CHIMERIC:author-mismatch]', note: 'z' },
  ]);
  ok('RATE_LIMITED counted', /RATE_LIMITED 1/.test(html));
  ok('RETRACTED counted', /RETRACTED ×1/.test(html));
  ok('CHIMERIC counted', /CHIMERIC ×1/.test(html));

  console.log('— parallel grounding: order + speedup —');
  // 6 claims, each fetch takes ~300ms; sequential would take ~1800ms+
  const sbPar = makeSandbox(async (url) => {
    await new Promise(r => setTimeout(r, 300));
    return { ok: false, status: 404 };
  });
  const parMd = '# T\n\n' + [1, 2, 3, 4, 5, 6].map(i => `Claim number ${i} [${i}].`).join(' ') +
    '\n\n## References\n\n' + [1, 2, 3, 4, 5, 6].map(i => `[${i}] Author${i}, A. Some title ${i}. 2020.`).join('\n\n');
  const t0 = Date.now();
  const ev = await sbPar.groundDraft(parMd, {}, null);
  const dt = Date.now() - t0;
  ok('all 6 claims processed', ev.length === 6, JSON.stringify(ev.length));
  ok('evidence order preserved', ev.every((e, i) => e.claim === `Claim number ${i + 1} [${i + 1}].`),
    JSON.stringify(ev.map(e => e.claim)));
  ok('parallel faster than sequential (6 claims x ~1050ms sequential -> well under 6300ms)', dt < 4000, dt + 'ms');
  ok('all UNVERIFIED (404s)', ev.every(e => e.base === 'UNVERIFIED'));

  console.log('— FABRICATED vs UNVERIFIED —');
  // all registries answer 404: positive non-existence
  const sb404 = makeSandbox(async () => ({ ok: false, status: 404 }));
  const fabMd = '# T\n\nFake paper arXiv:2401.99999. Fake DOI 10.9999/fake.doi.1234. ' +
    'Dangling marker [9]. Entry without identifiers [7].\n\n## References\n\n' +
    '[9] No identifiers in this entry at all.\n\n[7] Anonymous. A title no database knows. 2020.';
  const evFab = await sb404.groundDraft(fabMd, {}, null);
  const byClaim = {};
  evFab.forEach(e => { byClaim[e.claim] = e.base; });
  ok('fake arXiv -> FABRICATED', byClaim['Fake paper arXiv:2401.99999.'] === 'FABRICATED',
    JSON.stringify(byClaim));
  ok('fake DOI -> FABRICATED', byClaim['Fake DOI 10.9999/fake.doi.1234.'] === 'FABRICATED');
  ok('dangling marker -> UNVERIFIED not FABRICATED', byClaim['Dangling marker [9].'] === 'UNVERIFIED');
  ok('entry without identifiers -> UNVERIFIED not FABRICATED',
    byClaim['Entry without identifiers [7].'] === 'UNVERIFIED');
  ok('fabricated note names the identifier',
    evFab[0].note.includes('2401.99999') && /fabricated or mistyped/i.test(evFab[0].note));
  // 429 stays RATE_LIMITED, never FABRICATED
  const ev429 = await sb429.groundDraft('# T\n\nFake arXiv:2401.99999.\n', {}, null);
  ok('429 -> RATE_LIMITED not FABRICATED', ev429[0].base === 'RATE_LIMITED', ev429[0].base);
  // report counts it
  const htmlFab = renderReport([{ claim: 'x', base: 'FABRICATED', label: 'FABRICATED', note: 'n' }]);
  ok('FABRICATED counted', /FABRICATED 1/.test(htmlFab));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
