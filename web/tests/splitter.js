/* veripaper regression: reference-heading splitter.
 * Inline "## References" (same line as body text) must still split body
 * from reference list — otherwise entries leak into claims as fragments.
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
const sandbox = {
  console, setTimeout: (fn) => 0, clearTimeout: () => {},
  document: {
    readyState: 'complete', addEventListener: () => {},
    getElementById: () => mkEl(), createElement: () => mkEl(), body: mkEl(),
  },
  window: {}, navigator: {}, location: { href: '' },
  fetch: async () => { throw new Error('no network'); },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
  Blob: function () {},
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'ground.js' });
const { normalizeRefHeading, cutReferences, splitRefSection, extractPairs, parseReferences } = sandbox;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); };
};

const D2 = 'Graph neural networks solve protein folding [1]. ## References [1] Smith, J. Quantum graph networks for protein folding. Nature 2024. arXiv:2401.99999.';
const D5 = 'BERT improved language understanding [1]. Quantum consciousness drives learning [2]. ## References [1] Devlin, J. et al. BERT: Pre-training of deep bidirectional transformers. 2018. arXiv:1810.04805.\n\n[2] Penrose, R. Quantum microtubules and artificial general intelligence. 2024.';
const CLASSIC = '# Draft\n\nSome claim [1].\n\n## References\n\n[1] Real entry. arXiv:1706.03762.';

console.log('— inline heading normalization —');
ok('inline heading broken onto own line', normalizeRefHeading(D2).includes('[1].\n## References'));
ok('own-line heading stays line-anchored', /^## References/m.test(normalizeRefHeading(CLASSIC)));
ok('own-line heading not duplicated', !/\n## References\n## References/.test(normalizeRefHeading(CLASSIC)));
ok('no heading untouched', normalizeRefHeading('Just text.') === 'Just text.');

console.log('— cutReferences —');
const body2 = cutReferences(D2);
ok('D2 body excludes references', body2.trim() === 'Graph neural networks solve protein folding [1].', JSON.stringify(body2));
ok('D2 body has no Smith/arxiv text', !/Smith|2401\.99999/.test(body2));

console.log('— splitRefSection —');
const sec2 = splitRefSection(D2);
ok('D2 section holds the entry', /\[1\] Smith/.test(sec2) && /2401\.99999/.test(sec2), JSON.stringify(sec2.slice(0, 60)));
ok('D2 section excludes body', !/protein folding \[1\]\./.test(sec2));

console.log('— extractPairs (eval drafts) —');
const p2 = extractPairs(D2);
ok('D2 yields exactly 1 pair', p2.length === 1, JSON.stringify(p2.map(p => p.claim)));
ok('D2 pair is the real claim', p2[0] && p2[0].claim === 'Graph neural networks solve protein folding [1].');
const p5 = extractPairs(D5);
ok('D5 yields exactly 2 pairs (no fragments/dupes)', p5.length === 2, JSON.stringify(p5.map(p => p.claim)));
ok('D5 no fragment claims', !p5.some(p => /Penrose, R\.\]|\d{4}\. arXiv/.test(p.claim) && p.claim.length < 40));

console.log('— parseReferences (eval drafts) —');
const r2 = parseReferences(D2);
ok('D2 numeric 1 resolved', !!r2.numeric['1']);
ok('D2 entry has fake arxiv id', r2.numeric['1'] && r2.numeric['1'].arxiv_id === '2401.99999', JSON.stringify(r2.numeric['1']));
const r5 = parseReferences(D5);
ok('D5 [1] -> BERT arxiv', r5.numeric['1'] && r5.numeric['1'].arxiv_id === '1810.04805');
ok('D5 [2] -> no id (fake)', r5.numeric['2'] && !r5.numeric['2'].doi && !r5.numeric['2'].arxiv_id);

console.log('— regression: classic layout —');
const pc = extractPairs(CLASSIC);
ok('classic still yields 1 pair', pc.length === 1 && pc[0].cite_id === '1', JSON.stringify(pc.map(p => p.claim)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
