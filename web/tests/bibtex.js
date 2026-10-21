/* veripaper regression: BibTeX entry point (web/bibtex.js + bib mode in ground.js).
 * - parser: braces / quotes / @string / # concatenation / @comment / (…) entries
 * - entries → reference-list lines the existing parser resolves (DOI, arXiv, citekey)
 * - every entry goes through groundDraft with the same labels
 *   (CITED / FABRICATED / UNVERIFIED / RATE_LIMITED + [RETRACTED] / [CHIMERIC])
 * - bib mode is existence-level: no abstract fetch, no LLM call, no [STALE] tags
 * - client-side only: the only fetches are registry lookups
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const bibSrc = fs.readFileSync(path.join(__dirname, '..', 'bibtex.js'), 'utf8');
const groundSrc = fs.readFileSync(path.join(__dirname, '..', 'ground.js'), 'utf8');
function mkEl() {
  return {
    value: '', textContent: '', innerHTML: '', disabled: false, style: {}, dataset: {},
    addEventListener() {}, click() {}, scrollIntoView() {}, appendChild() {}, remove() {},
  };
}
function makeSandbox(fetchImpl) {
  const sandbox = {
    console,
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
  vm.runInContext(bibSrc, sandbox, { filename: 'bibtex.js' });
  vm.runInContext(groundSrc, sandbox, { filename: 'ground.js' });
  return sandbox;
}

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); };
};

const BIB = String.raw`% exported from a reference manager
@string{neurips = "Advances in Neural Information Processing Systems"}
@comment{this is ignored @article{nope, title={x}}}
@inproceedings{vaswani2017attention,
  title     = {Attention is {All} you Need},
  author    = {Vaswani, Ashish and Shazeer, Noam and others},
  booktitle = neurips,
  year      = 2017,
  eprint    = {1706.03762},
  archivePrefix = {arXiv}
}
@article{wakefield1998,
  title = "Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children",
  author = "Wakefield, A. J. and Murch, S. H.",
  journal = {The Lancet}, volume = {351}, pages = {637--641}, year = {1998},
  doi = {10.1016/S0140-6736(97)11096-0}
}
@article(fake2024,
  title = {Record perovskite efficiency via {\"o}ptimized strain},
  author = {Delacroix, M. and M{\"u}ller, J{\"o}rg},
  journal = {Nature}, year = {2024},
  url = {https://doi.org/10.1038/s41586-024-99999-9}
)
@misc{smith2017,
  title = {Attention is all you need},
  author = {John Smith and Jane Doe},
  howpublished = {NeurIPS} # { 2017},
  url = {https://arxiv.org/abs/1706.03762}
}
@article{noid2020,
  title = {A title no database knows},
  author = {Anon, A.},
  journal = {Journal of Nothing}, year = {2020}
}
`;

(async () => {
  const sb = makeSandbox();
  const { parseBibTeX, looksLikeBibTeX, bibCleanLatex, bibAuthorsToRef, bibEntryToRefLine,
    bibToDraft, parseReferences, extractPairs } = sb;

  console.log('— parser —');
  const p = parseBibTeX(BIB);
  ok('5 entries (comment skipped, string expanded)', p.entries.length === 5, JSON.stringify(p.entries.map(e => e.key)));
  ok('no parse errors', p.errors.length === 0, JSON.stringify(p.errors));
  const byKey = {};
  p.entries.forEach(e => { byKey[e.key] = e; });
  ok('@string macro expanded', byKey.vaswani2017attention.fields.booktitle === 'Advances in Neural Information Processing Systems');
  ok('bare number value', byKey.vaswani2017attention.fields.year === '2017');
  ok('nested braces kept for cleaning', byKey.vaswani2017attention.fields.title === 'Attention is {All} you Need');
  ok('quoted value', /^Ileal-lymphoid/.test(byKey.wakefield1998.fields.title));
  ok('(…) delimited entry', !!byKey.fake2024 && byKey.fake2024.type === 'article');
  ok('# concatenation', byKey.smith2017.fields.howpublished === 'NeurIPS 2017', byKey.smith2017.fields.howpublished);
  ok('unterminated entry reported, not guessed',
    parseBibTeX('@article{x, title={open').errors.length === 1);
  ok('entry without key reported', parseBibTeX('@article{title={x}}').errors.length === 1);
  ok('looksLikeBibTeX: .bib text', looksLikeBibTeX(BIB));
  ok('looksLikeBibTeX: markdown draft is not', !looksLikeBibTeX('# Draft\n\nClaim [1].\n\n## References\n[1] X.'));
  ok('looksLikeBibTeX: email-like @ in prose is not', !looksLikeBibTeX('Contact me @alice, thanks'));

  console.log('— LaTeX cleanup and authors —');
  ok('braces stripped', bibCleanLatex('{BERT}: Pre-training') === 'BERT: Pre-training');
  ok('accent macro', bibCleanLatex('M{\\"u}ller') === 'Müller', bibCleanLatex('M{\\"u}ller'));
  ok('\\"{o} form', bibCleanLatex('\\"{o}ptimized') === 'öptimized', bibCleanLatex('\\"{o}ptimized'));
  ok('en-dash', bibCleanLatex('637--641') === '637-641');
  ok('Last, First form', bibAuthorsToRef('Vaswani, Ashish and Shazeer, Noam') === 'Vaswani, A., Shazeer, N.');
  ok('First Last form', bibAuthorsToRef('John Smith and Jane Doe') === 'Smith, J., Doe, J.');
  ok('others -> et al.', bibAuthorsToRef('Vaswani, Ashish and others') === 'Vaswani, A., et al.');
  ok('hyphenated initials', bibAuthorsToRef('Chang, Ming-Wei') === 'Chang, M.-W.', bibAuthorsToRef('Chang, Ming-Wei'));
  ok('particle kept with surname', bibAuthorsToRef('Ludwig van Beethoven') === 'van Beethoven, L.');

  console.log('— entries become resolvable reference lines —');
  const line = bibEntryToRefLine(byKey.wakefield1998);
  ok('DOI carried', line.includes('doi:10.1016/S0140-6736(97)11096-0'), line);
  ok('DOI from url field', bibEntryToRefLine(byKey.fake2024).includes('doi:10.1038/s41586-024-99999-9'));
  ok('arXiv from eprint', bibEntryToRefLine(byKey.vaswani2017attention).includes('arXiv:1706.03762'));
  ok('arXiv from arxiv.org url', bibEntryToRefLine(byKey.smith2017).includes('arXiv:1706.03762'));
  ok('year not duplicated when venue has it', !/2017, 2017/.test(bibEntryToRefLine(byKey.smith2017)), bibEntryToRefLine(byKey.smith2017));
  const d = bibToDraft(BIB);
  ok('draft has one marker sentence per entry', extractPairs(d.draft).length === 5, JSON.stringify(extractPairs(d.draft)));
  const rm = parseReferences(d.draft);
  ok('citekey map has every entry', Object.keys(rm.citekey).length === 5, JSON.stringify(Object.keys(rm.citekey)));
  ok('DOI parsed back with balanced parens', rm.citekey.wakefield1998.doi === '10.1016/S0140-6736(97)11096-0', rm.citekey.wakefield1998.doi);
  ok('arXiv parsed back', rm.citekey.vaswani2017attention.arxiv_id === '1706.03762');
  ok('year parsed back', rm.citekey.noid2020.year === 2020);
  const dup = bibToDraft('@article{a, title={X}}\n@article{a, title={Y}}\n@article{b c, title={Z}}');
  ok('duplicate key skipped and reported', dup.entries.length === 1 && dup.skipped.some(s => s.reason === 'duplicate key'));

  console.log('— every entry through groundDraft, same labels —');
  const urls = [];
  const sbNet = makeSandbox(async (url, init) => {
    const u = String(url);
    urls.push(u);
    if (u.includes('datacite') && u.includes('arXiv.1706.03762')) return {
      ok: true, status: 200,
      json: async () => ({ data: { attributes: {
        titles: [{ title: 'Attention Is All You Need' }],
        creators: [{ name: 'Vaswani, Ashish' }, { name: 'Shazeer, Noam' }],
        publisher: 'arXiv', publicationYear: 2017 } } }),
    };
    if (u.includes('api.crossref.org/works/') && u.includes('10.1016')) return {
      ok: true, status: 200,
      json: async () => ({ message: {
        title: ['RETRACTED: Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children'],
        author: [{ given: 'A. J.', family: 'Wakefield' }],
        'container-title': ['The Lancet'], published: { 'date-parts': [[1998]] } } }),
    };
    if (u.includes('openrouter')) throw new Error('LLM must not be called in bib mode');
    return { ok: false, status: 404, json: async () => ({}) };
  });
  const dd = sbNet.bibToDraft(BIB);
  const ev = sbNet.bibLabelEvidence(await sbNet.groundDraft(dd.draft, { bibMode: true, apiKey: 'sk-should-be-ignored' }, null), dd.entries);
  const lab = {};
  ev.forEach(e => { lab[e.bibkey] = e.label; });
  ok('5 results, one per entry', ev.length === 5, JSON.stringify(lab));
  ok('real arXiv entry -> CITED', lab.vaswani2017attention === 'CITED', lab.vaswani2017attention);
  ok('retracted DOI -> CITED [RETRACTED]', lab.wakefield1998 === 'CITED [RETRACTED]', lab.wakefield1998);
  ok('unregistered DOI -> FABRICATED', lab.fake2024 === 'FABRICATED', lab.fake2024);
  ok('real title + wrong authors -> [CHIMERIC]', /^CITED \[CHIMERIC:author-mismatch\]$/.test(lab.smith2017), lab.smith2017);
  ok('no identifier, no match -> UNVERIFIED', lab.noid2020 === 'UNVERIFIED', lab.noid2020);
  ok('no [STALE] tag in bib mode (entries carry old years)', ev.every(e => !/STALE/.test(e.label)));
  ok('display text is "@key — title"', ev.some(e => e.claim === '@wakefield1998 — Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children'));
  ok('no LLM call even with a key', !urls.some(u => u.includes('openrouter')));
  ok('no abstract fetch (OpenAlex / Semantic Scholar paper endpoints)',
    !urls.some(u => /openalex\.org\/works|semanticscholar\.org\/graph\/v1\/paper\/(?!search)/.test(u)), JSON.stringify(urls.filter(u => /openalex|semanticscholar/.test(u))));
  const hosts = [...new Set(urls.map(u => new URL(u).host))].sort();
  const allowed = ['api.crossref.org', 'api.datacite.org', 'export.arxiv.org', 'www.ebi.ac.uk',
    'api.semanticscholar.org', 'dblp.org'];
  ok('only registry lookup hosts contacted', hosts.every(h => allowed.includes(h)), JSON.stringify(hosts));
  const html = sbNet.renderReport(ev, { unit: 'BibTeX entries' });
  ok('report counts entries', /5<\/b> BibTeX entries checked/.test(html));

  console.log('— 429 stays RATE_LIMITED in bib mode —');
  const sb429 = makeSandbox(async () => ({ ok: false, status: 429 }));
  const d4 = sb429.bibToDraft('@article{k, title={T}, doi={10.1234/abc}}');
  const e4 = await sb429.groundDraft(d4.draft, { bibMode: true }, null);
  ok('429 -> RATE_LIMITED not FABRICATED', e4[0].base === 'RATE_LIMITED', e4[0].base);

  console.log('— wiring —');
  ok('upload accepts .bib', /name\.endsWith\('\.bib'\)/.test(groundSrc));
  ok('Ground detects pasted BibTeX', /looksLikeBibTeX\(text\)/.test(groundSrc));
  const html2 = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  ok('index.html loads bibtex.js before ground.js',
    html2.indexOf('src="bibtex.js"') > 0 && html2.indexOf('src="bibtex.js"') < html2.indexOf('src="ground.js"'));
  ok('file input accepts .bib', /accept="[^"]*\.bib/.test(html2));
  ok('service worker caches bibtex.js', /'bibtex\.js'/.test(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8')));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
