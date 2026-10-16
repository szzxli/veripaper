/* veripaper regression: .docx / .pdf upload path.
 * - mammoth (vendored) extracts real .docx text
 * - groupPdfLines clusters pdf.js text items into reading-order lines
 * - extracted text flows through extractPairs/parseReferences unchanged
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
  console, setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (id) => clearTimeout(id),
  document: {
    readyState: 'complete', addEventListener: () => {},
    getElementById: () => mkEl(), createElement: () => mkEl(), body: mkEl(),
    querySelector: () => null, head: mkEl(),
  },
  window: {}, navigator: {}, location: { href: '' },
  fetch: async () => { throw new Error('no network'); },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
  Blob: function () {},
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'ground.js' });
const { groupPdfLines, extractPairs, parseReferences } = sandbox;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); };
};

(async () => {
  console.log('— mammoth extracts real .docx —');
  const mammoth = require('/tmp/vp_vendor/mammoth.min.js');
  const buf = fs.readFileSync('/tmp/vp_test/test.docx');
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const out = await mammoth.extractRawText({ arrayBuffer: ab });
  const text = (out.value || '').replace(/\r\n?/g, '\n');
  ok('docx text non-empty', text.length > 100, text.length);
  ok('docx keeps References heading on own line', /^References$/m.test(text));

  console.log('— extracted docx flows through the pipeline —');
  const pairs = extractPairs(text);
  ok('2 claims extracted', pairs.length === 2, JSON.stringify(pairs.map(p => p.claim)));
  const refmap = parseReferences(text);
  ok('[1] entry found', !!refmap.numeric['1']);
  ok('[1] arxiv extracted', refmap.numeric['1'] && refmap.numeric['1'].arxiv_id === '1706.03762');
  ok('[2] entry found', !!refmap.numeric['2']);

  console.log('— groupPdfLines: reading order —');
  // synthetic pdf.js items: two lines, y grows upward, second line's items shuffled
  const items = [
    { str: 'world', transform: [1, 0, 0, 1, 100, 700] },
    { str: 'Hello', transform: [1, 0, 0, 1, 72, 700] },
    { str: '[1]', transform: [1, 0, 0, 1, 72, 684] },
    { str: 'Smith, J.', transform: [1, 0, 0, 1, 100, 684] },
  ];
  const lines = groupPdfLines(items);
  ok('two lines grouped', lines.length === 2, JSON.stringify(lines));
  ok('top line first', lines[0] === 'Hello world', JSON.stringify(lines[0]));
  ok('second line intact', lines[1] === '[1] Smith, J.', JSON.stringify(lines[1]));
  ok('empty items skipped', groupPdfLines([{ str: '  ', transform: [1, 0, 0, 1, 0, 700] }]).length === 0);

  console.log('— upload wiring present —');
  ok('extractDocxText defined', typeof sandbox.extractDocxText === 'function');
  ok('extractPdfText defined', typeof sandbox.extractPdfText === 'function');
  ok('initFileUpload defined', typeof sandbox.initFileUpload === 'function');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
