/* veripaper web regression: heuristic hint, demo wiring, BibTeX export.
 * Evaluates web/ground.js in a DOM-stubbed sandbox and exercises the pure fns.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'ground.js'), 'utf8');

const listeners = {};
function mkEl() {
  return {
    value: '', textContent: '', innerHTML: '', disabled: false,
    style: {}, dataset: {},
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
    click: () => { (listeners.click || []).forEach(f => f()); },
    scrollIntoView: () => {}, appendChild: () => {}, remove: () => {},
  };
}
const els = {};
const sandbox = {
  console, setTimeout: (fn) => 0, clearTimeout: () => {},
  document: {
    readyState: 'complete',
    addEventListener: () => {},
    getElementById: (id) => (els[id] = els[id] || mkEl()),
    createElement: () => mkEl(),
    body: mkEl(),
  },
  window: {}, navigator: {}, location: { href: '' },
  fetch: async () => { throw new Error('no network in test'); },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
  Blob: function () {},
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'ground.js' });

const { keywordOverlap, heuristicSupportHint, evidenceToBibTeX, bibEscape } = sandbox;
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); };
};

console.log('— heuristic —');
// 1. strong overlap: claim words present in abstract
const ab1 = 'We propose the Transformer, a network architecture based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.';
const r1 = keywordOverlap('Transformers changed NLP forever', ab1);
ok('overlap is a number in [0,1]', typeof r1 === 'number' && r1 >= 0 && r1 <= 1, r1);
const h1 = heuristicSupportHint('Transformers changed NLP forever', ab1);
ok('hint mentions overlap + not-a-verdict', /heuristic/i.test(h1) && /not a verdict/i.test(h1), h1);
ok('hint never claims support/verdict direction', !/likely supports|does not support|may not support/i.test(h1), h1);

// 2. weak overlap
const h2 = heuristicSupportHint('Quantum error correction thresholds for surface codes',
  'We study photosynthesis in marine algae under low light conditions.');
ok('weak overlap labeled weak', /weak keyword overlap/.test(h2), h2);

// 3. no abstract -> null
ok('null abstract -> null hint', heuristicSupportHint('Some claim', null) === null);
ok('null abstract -> null overlap', keywordOverlap('Some claim', '') === null);

// 4. stopwords-only claim -> null
ok('stopword-only claim -> null', keywordOverlap('It is a the', ab1) === null);

// 5. stemming: transformers ~ transformer
const r5 = keywordOverlap('transformers', 'the transformer architecture');
ok('plural stemming matches', r5 === 1, r5);

console.log('— bibtex —');
const ev = [
  { title: 'Attention Is All You Need', authors: ['Vaswani, Ashish', 'Shazeer, Noam'],
    venue: 'Advances in Neural Information Processing Systems', year: 2017,
    doi: '10.48550/arXiv.1706.03762', arxiv_id: '', base: 'CITED' },
  { title: 'Deep learning', authors: ['LeCun, Yann'], venue: 'Nature',
    year: 2015, doi: '10.1038/nature14539', arxiv_id: '', base: 'CITED' },
  { title: '', doi: '', base: 'UNVERIFIED' }, // fake entry: excluded
  { title: 'Attention Is All You Need', authors: ['Vaswani, Ashish'],
    venue: 'NeurIPS', year: 2017, doi: '10.48550/arXiv.1706.03762', base: 'CITED' }, // dup DOI
];
const bib = evidenceToBibTeX(ev);
ok('two entries after dedupe', (bib.match(/^@/gm) || []).length === 2, bib.slice(0, 120));
ok('proceedings -> @inproceedings', /@inproceedings\{veripaper001/.test(bib));
ok('journal -> @article', /@article\{veripaper002/.test(bib));
ok('fake entry excluded (no veripaper003)', !/veripaper003/.test(bib));
ok('doi present', bib.includes('10.1038/nature14539'));
ok('escape braces', bibEscape('a{b}c') === 'a\\{b\\}c');

// arXiv-only -> @misc + eprint
const bib2 = evidenceToBibTeX([{ title: 'Some preprint', authors: ['A. Uthor'], venue: '',
  year: 2024, doi: '', arxiv_id: '2401.00001', base: 'CITED' }]);
ok('arxiv-only -> @misc + eprint', /@misc/.test(bib2) && /eprint = \{2401\.00001\}/.test(bib2), bib2.slice(0, 200));

console.log('— demo wiring —');
ok('demo-btn listener registered', !!els['demo-btn'], Object.keys(els).join(','));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
