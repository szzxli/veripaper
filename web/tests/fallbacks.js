/* veripaper web regression: free fallbacks, request queue, cooldown, cache —
 * 1. Retry-After parsing (seconds + HTTP-date), 503 retry, long Retry-After
 *    -> host cooldown + fail fast (no long sleep), give-up cooldown
 * 2. polite-pool mailto on Crossref / OpenAlex
 * 3. bibliographic chain: Crossref -> DataCite/arXiv -> OpenAlex -> DBLP ->
 *    Semantic Scholar LAST; S2 not called when a free source matched
 * 4. a Semantic Scholar 429 no longer ends in RATE_LIMITED when two other
 *    indexes answered cleanly (UNVERIFIED, note names the skipped source);
 *    everything limited still -> RATE_LIMITED
 * 5. DBLP bot-check HTML = unavailable, not a clean miss
 * 6. index-record match without DOI -> CITED (+ chimeric check);
 *    lookup-derived DOI that fails to verify is never FABRICATED
 * 7. cache: bib2 results served offline; rate-limited results not cached
 * 8. abstract source order: Crossref-embedded / OpenAlex before S2
 */
'use strict';
const { makeSandbox, resp, harness } = require('./_sandbox');
const { ok, done } = harness();

(async () => {
  console.log('— Retry-After parsing —');
  {
    const sb = makeSandbox();
    ok('seconds', sb.vpRetryAfterMs(resp(429, {}, { 'Retry-After': '3' })) === 3000);
    const d = new Date(Date.now() + 5000).toUTCString();
    const ms = sb.vpRetryAfterMs(resp(429, {}, { 'Retry-After': d }));
    ok('HTTP-date', ms > 3000 && ms <= 5000, String(ms));
    ok('missing header -> 0', sb.vpRetryAfterMs(resp(429, {})) === 0);
    ok('no headers object -> 0', sb.vpRetryAfterMs({ status: 429 }) === 0);
    ok('backoff grows exponentially', sb.vpBackoffMs(0, 0) < 1600 && sb.vpBackoffMs(2, 0) >= 4000);
    ok('backoff capped', sb.vpBackoffMs(10, 0) <= 16500);
  }

  console.log('— 503 is retried like 429 —');
  {
    let n = 0;
    const sb = makeSandbox(async () => (++n === 1 ? resp(503, {}, { 'Retry-After': '0' }) : resp(200, {})));
    const r = await sb.vpFetch('https://api.datacite.org/dois/x');
    ok('503 then 200', r.ok && n === 2, 'n=' + n);
  }

  console.log('— long Retry-After -> cooldown, fail fast —');
  {
    let n = 0;
    const sb = makeSandbox(async () => { n++; return resp(429, {}, { 'Retry-After': '1953' }); });
    const t0 = Date.now();
    const r1 = await sb.vpFetch('https://api.openalex.org/works?search=x');
    const r2 = await sb.vpFetch('https://api.openalex.org/works?search=y');
    const dt = Date.now() - t0;
    ok('no sleep on a 30-minute Retry-After', dt < 2000, dt + 'ms');
    ok('first call reached the network once', n === 1, 'n=' + n);
    ok('second call failed fast locally (429, no network)', r2.status === 429 && r2.local === true && n === 1);
    ok('cooldown persisted', /api\.openalex\.org/.test(sb.localStorage.getItem('veripaper-cooldown-v1') || ''));
    ok('other hosts unaffected', sb.vpHostCoolingMs('api.crossref.org') === 0);
  }
  {
    let n = 0;
    const sb = makeSandbox(async () => { n++; return resp(429, {}, { 'Retry-After': '0' }); });
    await sb.vpFetch('https://api.semanticscholar.org/graph/v1/paper/search?q=a');
    ok('give-up after retries cools the host down', sb.vpHostCoolingMs('api.semanticscholar.org') > 30000);
    const before = n;
    const r = await sb.vpFetch('https://api.semanticscholar.org/graph/v1/paper/search?q=b');
    ok('...so the next S2 call costs no request', r.status === 429 && n === before);
  }

  console.log('— polite pool mailto —');
  {
    const sb = makeSandbox(async () => resp(404, {}));
    await sb.crossrefLookup('[1] Smith, J. A long enough reference entry title. 2020.', 2020);
    await sb.openalexLookup('[1] Smith, J. A long enough reference entry title here. 2020.', 2020);
    await sb.verifyDoi('10.1000/abc');
    const cr = sb.__calls.filter(u => u.includes('api.crossref.org'));
    const oa = sb.__calls.filter(u => u.includes('api.openalex.org'));
    ok('Crossref requests carry mailto', cr.length >= 2 && cr.every(u => u.includes('mailto=szzxli163%40gmail.com')), cr.join(' '));
    ok('OpenAlex requests carry mailto', oa.length >= 2 && oa.every(u => u.includes('mailto=szzxli163%40gmail.com')), oa.join(' '));
  }

  console.log('— guessEntryTitle —');
  {
    const sb = makeSandbox();
    ok('Vaswani entry', sb.guessEntryTitle('[1] Vaswani, A., et al. Attention is all you need. NeurIPS 2017.') === 'Attention is all you need');
    ok('APA entry', sb.guessEntryTitle('[1] He, K., Zhang, X., Ren, S., & Sun, J. (2016). Deep residual learning for image recognition. CVPR.') === 'Deep residual learning for image recognition');
    ok('two authors + &', sb.guessEntryTitle('[1] Okafor, C., & Lindqvist, M. Self-healing polymer composites via microvascular networks. Science 2022.') === 'Self-healing polymer composites via microvascular networks');
  }

  const DATACITE_ATTN = { data: [{ id: '10.48550/arxiv.1706.03762', attributes: {
    doi: '10.48550/arxiv.1706.03762', titles: [{ title: 'Attention Is All You Need' }], publicationYear: 2017,
    creators: [{ name: 'Vaswani, Ashish' }, { name: 'Shazeer, Noam' }], publisher: 'arXiv' } }] };
  const DATACITE_REC = { data: { attributes: { titles: [{ title: 'Attention Is All You Need' }],
    creators: [{ name: 'Vaswani, Ashish' }, { name: 'Shazeer, Noam' }], publisher: 'arXiv', publicationYear: 2017,
    descriptions: [{ descriptionType: 'Abstract', description: 'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.' }] } } };

  console.log('— chain order: free sources first, Semantic Scholar last —');
  {
    const sb = makeSandbox(async (url) => {
      if (url.includes('api.crossref.org/works?')) return resp(200, { message: { items: [] } });
      if (url.includes('api.datacite.org/dois?')) return resp(200, DATACITE_ATTN);
      if (url.includes('api.datacite.org/dois/')) return resp(200, DATACITE_REC);
      return resp(404, {});
    });
    const ev = await sb.groundDraft('Self-attention underpins most modern language models [1].\n\n## References\n[1] Vaswani, A., et al. Attention is all you need. NeurIPS 2017.', { keyless: false }, null);
    ok('no-DOI entry resolved via DataCite/arXiv -> CITED', ev[0].base === 'CITED', ev[0].base + ' | ' + ev[0].note);
    ok('resolved to the arXiv DOI', /1706\.03762/i.test(ev[0].doi), ev[0].doi);
    ok('Semantic Scholar never called', !sb.__calls.some(u => u.includes('semanticscholar')), sb.__calls.join('\n'));
    ok('OpenAlex search not needed either', !sb.__calls.some(u => u.includes('api.openalex.org/works?search')));
  }
  {
    // chimeric through the DataCite fallback
    const sb = makeSandbox(async (url) => {
      if (url.includes('api.crossref.org/works?')) return resp(200, { message: { items: [] } });
      if (url.includes('api.datacite.org/dois?')) return resp(200, DATACITE_ATTN);
      if (url.includes('api.datacite.org/dois/')) return resp(200, DATACITE_REC);
      return resp(404, {});
    });
    const ev = await sb.groundDraft('Self-attention underpins most modern language models [1].\n\n## References\n[1] Smith, J., et al. Attention is all you need. NeurIPS 2017.', { keyless: false }, null);
    ok('chimeric flagged via DataCite record', /\[CHIMERIC:author-mismatch\]/.test(ev[0].label), ev[0].label);
  }

  console.log('— S2 429 is not the end of the road —');
  const FAKE = 'Entanglement routing is promising [1].\n\n## References\n[1] Pemberton, R., et al. Quantum entanglement routing in metropolitan fiber networks. Nature Photonics 2023.';
  {
    const sb = makeSandbox(async (url) => {
      if (url.includes('api.crossref.org/works?')) return resp(200, { message: { items: [] } });
      if (url.includes('api.datacite.org/dois?')) return resp(200, { data: [] });
      if (url.includes('api.openalex.org')) return resp(429, { error: 'budget' }, { 'Retry-After': '1900' });
      if (url.includes('dblp.org')) return resp(202, '<!doctype html><title>Making sure you are not a bot</title>');
      if (url.includes('semanticscholar')) return resp(429, {}, { 'Retry-After': '600' });
      return resp(404, {});
    });
    const t0 = Date.now();
    const ev = await sb.groundDraft(FAKE, {}, null);
    ok('two clean misses + S2 429 -> UNVERIFIED (not RATE_LIMITED)', ev[0].base === 'UNVERIFIED', ev[0].base + ' | ' + ev[0].note);
    ok('note names the sources that answered', /CrossRef/.test(ev[0].note) && /DataCite/.test(ev[0].note), ev[0].note);
    ok('note names the rate-limited sources honestly', /rate-limited: .*Semantic Scholar/.test(ev[0].note), ev[0].note);
    ok('S2 consulted last', sb.__calls.findIndex(u => u.includes('semanticscholar')) > sb.__calls.findIndex(u => u.includes('dblp')));
    ok('long Retry-Afters did not stall the run', Date.now() - t0 < 8000, (Date.now() - t0) + 'ms');
  }
  {
    const sb = makeSandbox(async () => resp(429, {}, { 'Retry-After': '900' }));
    const ev = await sb.groundDraft(FAKE, {}, null);
    ok('everything limited -> still RATE_LIMITED', ev[0].base === 'RATE_LIMITED', ev[0].base);
    const bl = await sb.bibliographicLookup('[1] Pemberton, R., et al. Quantum entanglement routing in metropolitan fiber networks. Nature Photonics 2023.', 2023);
    ok('limited result not cached', !/bib2:/.test(sb.localStorage.getItem('veripaper-cache-v1') || ''), String(bl.limited));
  }

  console.log('— DBLP bot-check page is unavailable, not a miss —');
  {
    const sb = makeSandbox(async () => resp(200, '<!doctype html><title>Making sure you are not a bot</title>'));
    const r = await sb.dblpLookup('[1] Smith, J. A long enough reference entry title. 2020.', 2020);
    ok('dblp HTML -> unavailable', r.status === 'unavailable', r.status);
  }

  console.log('— index record without DOI; lookup DOIs are never FABRICATED —');
  {
    const sb = makeSandbox(async (url) => {
      if (url.includes('api.crossref.org/works?')) return resp(200, { message: { items: [] } });
      if (url.includes('api.datacite.org/dois?')) return resp(200, { data: [] });
      if (url.includes('api.openalex.org/works?')) return resp(200, { results: [{ id: 'W1', doi: 'https://doi.org/10.99999/weird',
        title: 'Self-Healing Polymer Composites via Microvascular Networks', publication_year: 2022,
        authorships: [{ author: { display_name: 'Chidi Okafor' } }], primary_location: { source: { display_name: 'Science' } } }] });
      return resp(404, {});
    });
    const ev = await sb.groundDraft('Microvascular networks restore function [1].\n\n## References\n[1] Okafor, C., & Lindqvist, M. Self-healing polymer composites via microvascular networks. Science 2022.', { keyless: false }, null);
    ok('OpenAlex record match -> CITED', ev[0].base === 'CITED', ev[0].base + ' | ' + ev[0].note);
    ok('not FABRICATED although its DOI did not re-verify', ev[0].base !== 'FABRICATED');
    const md = 'X [1].\n\n## References\n[1] Okafor, C., & Lindqvist, M. Self-healing polymer composites via microvascular networks. Science 2022.';
    const n0 = sb.__calls.length;
    const rc = await sb.resolveCitation({ cite_type: 'numeric', cite_id: '1' }, sb.parseReferences(md), new Map());
    ok('resolution note explains the record fallback', /index that matched/.test(rc.note), rc.note);
    ok('Semantic Scholar not used for the lookup', !sb.__calls.slice(n0).some(u => u.includes('semanticscholar')));
  }

  console.log('— bib2 cache —');
  {
    const sb = makeSandbox(async (url) => {
      if (url.includes('api.crossref.org/works?')) return resp(200, { message: { items: [] } });
      if (url.includes('api.datacite.org/dois?')) return resp(200, DATACITE_ATTN);
      return resp(404, {});
    });
    const e = '[1] Vaswani, A., et al. Attention is all you need. NeurIPS 2017.';
    const r1 = await sb.bibliographicLookup(e, 2017);
    const n = sb.__calls.length;
    const r2 = await sb.bibliographicLookup(e, 2017);
    ok('second lookup from cache, no network', r2.via === 'datacite' && sb.__calls.length === n && r1.via === 'datacite');
  }

  console.log('— abstract sources: free first, S2 last —');
  {
    const sb = makeSandbox(async (url) => {
      if (url.includes('api.openalex.org/works/doi:')) return resp(200, { id: 'W2', title: 'T',
        abstract_inverted_index: { Deeper: [0], neural: [1], networks: [2], are: [3], more: [4], difficult: [5], to: [6], 'train.': [7],
          We: [8], present: [9], a: [10], residual: [11], learning: [12], framework: [13], to2: [], ease: [14], the: [15], training: [16], 'today.': [17] } });
      return resp(404, {});
    });
    const ab = await sb.fetchAbstract({ doi: '10.1109/CVPR.2016.90' }, new Map());
    ok('OpenAlex inverted index rebuilt', /^Deeper neural networks are more difficult to train\. We present a residual/.test(ab || ''), ab);
    ok('S2 not called when OpenAlex had it', !sb.__calls.some(u => u.includes('semanticscholar')));
  }
  {
    const sb = makeSandbox(async () => resp(404, {}));
    const long = 'This abstract came with the Crossref record and is long enough to be used directly as the abstract text for judging.';
    const ab = await sb.fetchAbstract({ doi: '10.1/x', abstract: long }, new Map());
    ok('Crossref-embedded abstract reused, zero requests', ab === long && sb.__calls.length === 0, sb.__calls.join(' '));
    ok('JATS stripped', sb.stripJats('<jats:title>Abstract</jats:title><jats:p>Hello <jats:italic>world</jats:italic>.</jats:p>') === 'Hello world .');
  }

  done();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
