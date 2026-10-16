/* veripaper — in-browser grounding pipeline.
 * Faithful port of veripaper/verify/extract.py, references.py, claims.py
 * and pipeline.py. Lookup, not generation. Downgrade-only.
 * No backend, no signup. Optional BYOK (OpenRouter) for content judgment.
 */
'use strict';

/* Faithful port of veripaper/verify/extract.py */
const ABBREV = ['et al.', 'e.g.', 'i.e.', 'Fig.', 'fig.', 'Eq.', 'vs.', 'U.S.', 'U.K.'];
const DOI_RE = /(?:https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,}\/[^\s\]\"'<>]+)/gi;
/* DOIs may legally contain balanced parentheses (e.g. Wiley's
 * 10.1016/S0140-6736(97)11096-0). The regex above lets them through;
 * this strips trailing punctuation and any UNBALANCED trailing ')'. */
function cleanDoi(raw) {
  let d = String(raw || '').replace(/[.,;:]+$/, '');
  const opens = s => (s.match(/\(/g) || []).length;
  const closes = s => (s.match(/\)/g) || []).length;
  while (d.endsWith(')') && opens(d) < closes(d)) d = d.slice(0, -1).replace(/[.,;:]+$/, '');
  return d;
}
const ARXIV_RE = /(?:arXiv:)?(\d{4}\.\d{4,5}(?:v\d+)?|[a-z\-]+\/\d{7}(?:v\d+)?)/gi;
const PANDOC_RE = /\[@([^\]]+)\]/g;
const NUMERIC_RE = /\[(\d{1,3})\]/g;
const AUTHOR_YEAR_RE = /\(\s*([A-Z][A-Za-z'’\-]+(?:\s+et al\.)?(?:\s*(?:&|and)\s+[A-Z][A-Za-z'’\-]+)?(?:\s*,\s*[A-Z][A-Za-z'’\-]+)*,?\s*\d{4}[a-z]?(?:\s*;\s*[^)]+)?)\s*\)/g;
const URL_RE = /https?:\/\/[^\s\]\)\"'<>]+/gi;
const YEAR_RE = /\b((?:19|20)\d{2})\b/g;
const NUMERIC_ENTRY_RE = /^\[(\d{1,3})\]\s*(.*)$/;
const CITEKEY_ENTRY_RE = /^\[@([^\]]+)\]\s*(.*)$/;
const REF_HEADING_RE = /^#{1,6}\s*(references|bibliography|works cited)\b/im;
const REF_HEADING_INLINE_RE = /([.!?:])\s*(#{1,6}\s*(?:references|bibliography|works cited)\b)/gi;
/* Pasted drafts often run the heading together with body text
 * ("...folding [1]. ## References [1] Smith..."), which the line-anchored
 * heading regex would otherwise miss — reference entries then leak into
 * claims as fragments/duplicates. Break it onto its own line first. */
function normalizeRefHeading(md) {
  return md.replace(REF_HEADING_INLINE_RE, '$1\n$2');
}
const FENCE_RE = /```[\s\S]*?```/g;
const SENT_SPLIT_RE = /(?<=[.!?])\s+(?=[A-Z0-9"'“(\[])/;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const gesc = s => String(s || '').replace(/[&<>"]/g,
  m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

/* ---------------- extraction ---------------- */

function cutReferences(md) {
  md = normalizeRefHeading(md);
  const m = REF_HEADING_RE.exec(md);
  return m ? md.slice(0, m.index) : md;
}

function splitSentences(text) {
  let prot = text;
  ABBREV.forEach((ab, i) => { prot = prot.split(ab).join('\u0000' + i + '\u0000'); });
  return prot.split(SENT_SPLIT_RE).map(p => {
    ABBREV.forEach((ab, i) => { p = p.split('\u0000' + i + '\u0000').join(ab); });
    return p.split(/\s+/).join(' ').trim();
  }).filter(Boolean);
}

function markersInSentence(sent) {
  const found = [];
  const seen = new Set();
  const add = (raw, type, id) => {
    const key = type + '|' + id;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ raw, type, id });
  };
  let m;
  DOI_RE.lastIndex = 0;
  while ((m = DOI_RE.exec(sent))) add(m[0], 'doi', cleanDoi(m[1]));
  ARXIV_RE.lastIndex = 0;
  while ((m = ARXIV_RE.exec(sent))) {
    if (found.some(f => f.type === 'doi' && f.id.includes(m[1]))) continue;
    add(m[0], 'arxiv', m[1]);
  }
  PANDOC_RE.lastIndex = 0;
  while ((m = PANDOC_RE.exec(sent))) add(m[0], 'citekey', m[1].trim());
  NUMERIC_RE.lastIndex = 0;
  while ((m = NUMERIC_RE.exec(sent))) {
    if (found.some(f => f.type === 'citekey' && f.raw.includes(m[0]))) continue;
    add(m[0], 'numeric', m[1]);
  }
  AUTHOR_YEAR_RE.lastIndex = 0;
  while ((m = AUTHOR_YEAR_RE.exec(sent))) add(m[0], 'author-year', m[1]);
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(sent))) {
    const url = m[0].replace(/[.,;:]+$/, '');
    if (url.includes('doi.org')) continue;
    if (found.some(f => (f.type === 'doi' || f.type === 'arxiv') && f.raw.includes(url))) continue;
    add(url, 'url', url);
  }
  return found;
}

function normalizeWs(s) { return s.replace(/[\u00a0\u2007\u202f\u2009\u200a]/g, ' '); }

function extractPairs(md) {
  const text = cutReferences(normalizeWs(md).replace(FENCE_RE, ''));
  const lines = text.split('\n').filter(ln => !ln.trimStart().startsWith('#'));
  const pairs = [];
  splitSentences(lines.join('\n')).forEach((sent, si) => {
    markersInSentence(sent).forEach(mk => {
      pairs.push({ claim: sent, cite_raw: mk.raw, cite_type: mk.type, cite_id: mk.id, sentence_no: si });
    });
  });
  return pairs;
}

/* ---------------- reference list ---------------- */

function splitRefSection(md) {
  md = normalizeRefHeading(md);
  const m = REF_HEADING_RE.exec(md);
  return m ? md.slice(m.index + m[0].length) : '';
}

function norm(s) { return s.toLowerCase().replace(/[^a-z0-9]/g, ''); }

function splitEntries(section) {
  const entries = [];
  for (const part of section.split(/(?=^\[\d{1,3}\])/m)) {
    const p = part.trim();
    if (!p) continue;
    for (const chunk of p.split(/\n\s*\n/)) {
      const c = chunk.split('\n').map(l => l.trim()).filter(Boolean).join(' ');
      if (c && !c.startsWith('#')) entries.push(c);
    }
  }
  return entries;
}

const YEAR_LETTER_RE = /\b((?:19|20)\d{2})([a-z])?\b/g;
function entryIds(entry) {
  let doi = null, arxivId = null, year = null, ykey = [null, ''];
  DOI_RE.lastIndex = 0;
  let m = DOI_RE.exec(entry);
  if (m) doi = cleanDoi(m[1]);
  ARXIV_RE.lastIndex = 0;
  while ((m = ARXIV_RE.exec(entry))) {
    if (doi && doi.includes(m[1])) continue;
    arxivId = m[1]; break;
  }
  YEAR_RE.lastIndex = 0;
  m = YEAR_RE.exec(entry);
  if (m) year = parseInt(m[1], 10);
  YEAR_LETTER_RE.lastIndex = 0;
  m = YEAR_LETTER_RE.exec(entry);
  if (m) ykey = [parseInt(m[1], 10), m[2] || ''];
  return { doi, arxiv_id: arxivId, year, ykey };
}

function parseReferences(md) {
  md = normalizeWs(md);
  const refmap = { numeric: {}, citekey: {}, authoryear: {} };
  for (const raw of splitEntries(splitRefSection(md))) {
    const entry = Object.assign({ raw }, entryIds(raw));
    let m = NUMERIC_ENTRY_RE.exec(raw);
    if (m) { refmap.numeric[m[1]] = entry; continue; }
    m = CITEKEY_ENTRY_RE.exec(raw);
    if (m) { refmap.citekey[m[1].trim()] = entry; continue; }
    m = /^\s*([A-Z][A-Za-z'’\-]+)/.exec(raw);
    if (m && entry.ykey[0]) {
      const key = m[1].toLowerCase() + '|' + entry.ykey[0] + '|' + entry.ykey[1];
      (refmap.authoryear[key] = refmap.authoryear[key] || []).push(entry);
    }
  }
  return refmap;
}

function parseIntextAuthoryear(marker) {
  const sm = /^\s*([A-Za-z'’\-]+)/.exec(marker);
  YEAR_LETTER_RE.lastIndex = 0;
  const y = YEAR_LETTER_RE.exec(marker);
  if (!sm || !y) return null;
  const surname = sm[1].toLowerCase().replace(/[^a-z]/g, '');
  if (!surname || surname === 'et') return null;
  return surname + '|' + parseInt(y[1], 10) + '|' + (y[2] || '');
}

async function crossrefLookup(entryRaw, entryYear) {
  const q = entryRaw.replace(/^\[(@?[^\]]+)\]\s*/, '').trim().slice(0, 500);
  const none = { doi: null, arxiv_id: null, limited: false };
  if (q.length < 15) return none;
  const url = 'https://api.crossref.org/works?query.bibliographic=' + encodeURIComponent(q) +
    '&rows=3&select=DOI,title,published,author';
  let r;
  try { r = await fetch(url, { headers: { Accept: 'application/json' } }); }
  catch { return none; }
  if (!r.ok) return r.status === 429 ? { doi: null, arxiv_id: null, limited: true } : none;
  let items;
  try { items = (await r.json()).message.items; } catch { return none; }
  const nEntry = norm(entryRaw);
  for (const it of (items || [])) {
    const title = ((it.title || [])[0] || '');
    if (norm(title).length < 10) continue;
    if (!nEntry.includes(norm(title))) continue;
    if (entryYear) {
      let pub = null;
      try { pub = (it.published || {})['date-parts'][0][0]; } catch { /* ignore */ }
      if (pub && Math.abs(pub - entryYear) > 1) continue;
    }
    if (it.DOI) return { doi: it.DOI, arxiv_id: null, limited: false };
  }
  return none;
}

async function s2Lookup(entryRaw, entryYear) {
  const q = entryRaw.replace(/^\[(@?[^\]]+)\]\s*/, '').trim().slice(0, 300);
  const none = { doi: null, arxiv_id: null, limited: false };
  if (q.length < 15) return none;
  let r;
  try {
    r = await fetch('https://api.semanticscholar.org/graph/v1/paper/search?' + new URLSearchParams({
      query: q, fields: 'title,abstract,externalIds,year', limit: '3' }));
  } catch { return none; }
  if (!r.ok) return r.status === 429 ? { doi: null, arxiv_id: null, limited: true } : none;
  let data;
  try { data = (await r.json()).data || []; } catch { return none; }
  const nEntry = norm(entryRaw);
  for (const it of data) {
    const title = it.title || '';
    if (norm(title).length < 10) continue;
    if (!nEntry.includes(norm(title))) continue;
    if (entryYear && it.year && Math.abs(it.year - entryYear) > 1) continue;
    const ids = it.externalIds || {};
    if (ids.DOI || ids.ArXiv) return { doi: ids.DOI || null, arxiv_id: ids.ArXiv || null, limited: false };
  }
  return none;
}

async function bibliographicLookup(entryRaw, entryYear) {
  const cr = await crossrefLookup(entryRaw, entryYear);
  if (cr.doi) return { doi: cr.doi, arxiv_id: null, via: 'crossref', limited: false };
  const s2 = await s2Lookup(entryRaw, entryYear);
  if (s2.doi || s2.arxiv_id) return { doi: s2.doi, arxiv_id: s2.arxiv_id, via: 'semanticscholar', limited: false };
  const db = await dblpLookup(entryRaw, entryYear);
  if (db.doi) return { doi: db.doi, arxiv_id: null, via: 'dblp', limited: false };
  return { doi: null, arxiv_id: null, via: 'none', limited: !!(cr.limited || s2.limited || db.limited) };
}

async function resolveMarker(type, id, refmap) {
  let entry = null;
  if (type === 'numeric') entry = refmap.numeric[id] || null;
  else if (type === 'citekey') entry = refmap.citekey[id] || null;
  else if (type === 'author-year') {
    const key = parseIntextAuthoryear(id);
    if (key) {
      const amap = refmap.authoryear;
      let cands = amap[key] || [];
      if (!cands.length) {
        const p2 = key.split('|').slice(0, 2).join('|') + '|';
        cands = Object.keys(amap).filter(k => k.startsWith(p2)).flatMap(k => amap[k]);
      }
      if (cands.length === 1) entry = cands[0];
      else if (cands.length > 1)
        return { doi: null, arxiv_id: null, via: 'none', note: `ambiguous: ${cands.length} entries match '${id}'` };
    }
  }
  if (!entry)
    return { doi: null, arxiv_id: null, via: 'none', note: `no reference entry for [${id}]` };
  if (entry.doi || entry.arxiv_id)
    return { doi: entry.doi, arxiv_id: entry.arxiv_id, via: 'embedded',
      entryRaw: entry.raw, note: 'identifier found in reference entry' };
  const bl = await bibliographicLookup(entry.raw, entry.year);
  if (bl.doi || bl.arxiv_id) {
    const src = bl.via === 'crossref' ? 'CrossRef' : bl.via === 'dblp' ? 'DBLP' : 'Semantic Scholar';
    return { doi: bl.doi, arxiv_id: bl.arxiv_id, via: bl.via,
      entryRaw: entry.raw, note: src + ' bibliographic match (title-in-entry + year)' };
  }
  return { doi: null, arxiv_id: null, via: 'none', limited: !!bl.limited,
    note: bl.limited
      ? 'sources rate-limited while checking this entry — not checked, not proven fake'
      : 'reference entry has no DOI/arXiv ID and no confident bibliographic match' };
}

/* ---------------- existence (reuse page's verify fns when present) ---------------- */

/* Retraction signal: CrossRef prefixes retracted titles with "RETRACTED:"
 * (verified against known-retracted DOIs). Only CrossRef carries it —
 * no signal means "unknown", never "not retracted". */
const RETRACTED_RE = /^\s*(retracted|withdrawn)\s*:/i;
function isRetractedTitle(t) { return RETRACTED_RE.test(t || ''); }

/* Chimeric-hallucination detection: the title matches a real paper but the
 * authors named in the entry match none of the paper's real authors.
 * Only judges when the entry actually names authors (et al. / "Surname, I."
 * pattern); author-less entries are not flaggable. */
function detectChimeric(entryRaw, authors) {
  const arr = Array.isArray(authors) ? authors : String(authors || '').split(/,\s*/).filter(Boolean);
  const fams = arr.map(a => {
    const s = String(a);
    const parts = s.split(/[\s,]+/).filter(Boolean);
    const fam = s.includes(',') ? parts[0] : parts[parts.length - 1];
    return (fam || '').toLowerCase().replace(/[^a-z]/g, '');
  }).filter(f => f.length > 1);
  if (!fams.length || !entryRaw) return false;
  if (!/(et al\.|[A-Z][a-z]{1,},\s*[A-Z]\.)/.test(entryRaw)) return false;
  const words = new Set((String(entryRaw).toLowerCase().match(/[a-z]{2,}/g) || []));
  return !fams.some(f => words.has(f));
}

async function pgCheckCrossRef(doi) {
  const r = await fetch('https://api.crossref.org/works/' + encodeURIComponent(doi),
    { headers: { Accept: 'application/json' } });
  if (!r.ok) return r.status === 429 ? { limited: true } : null;
  const m = (await r.json()).message;
  const title = (m.title || ['(no title)'])[0];
  const yr = (m['published-print'] || m['published-online'] || m.created || {})['date-parts'];
  return {
    title,
    authors: (m.author || []).map(a => ((a.given || '') + ' ' + (a.family || '')).trim()).filter(Boolean).slice(0, 8),
    venue: ((m['container-title'] || [])[0] || ''),
    year: yr ? yr[0][0] : '',
    exists: true,
    retracted: isRetractedTitle(title),
  };
}
async function pgCheckDataCite(doi) {
  const r = await fetch('https://api.datacite.org/dois/' + encodeURIComponent(doi),
    { headers: { Accept: 'application/vnd.api+json' } });
  if (!r.ok) return r.status === 429 ? { limited: true } : null;
  const a = (await r.json()).data.attributes;
  const title = (((a.titles || [])[0] || {}).title || '(no title)');
  return {
    title,
    authors: (a.creators || []).map(c => c.name).filter(Boolean).slice(0, 8),
    venue: a.publisher || '',
    year: a.publicationYear || '',
    exists: true,
    retracted: isRetractedTitle(title),
  };
}
/* Europe PMC: biomedical/life-science coverage incl. abstracts; CORS-enabled. */
async function pgCheckEuropePMC(doi) {
  const r = await fetch('https://www.ebi.ac.uk/europepmc/webservices/rest/search?' + new URLSearchParams({
    query: 'DOI:"' + doi + '"', format: 'json', resultType: 'core', pageSize: '1' }));
  if (!r.ok) return r.status === 429 ? { limited: true } : null;
  const res = (((await r.json()).resultList || {}).result || []);
  if (!res.length) return null;
  const p = res[0];
  const title = p.title || '(no title)';
  return {
    title,
    abstract: (p.abstractText || '').trim() || null,
    authors: (p.authorString || '').split(/,\s*/).filter(Boolean).slice(0, 8),
    venue: (((p.journalInfo || {}).journal || {}).title || ''),
    year: p.pubYear || '',
    exists: true,
    retracted: isRetractedTitle(title),
  };
}
/* DBLP: computer-science bibliography; title search for entries without IDs. */
async function dblpLookup(entryRaw, entryYear) {
  const q = entryRaw.replace(/^\[(@?[^\]]+)\]\s*/, '').trim().slice(0, 300);
  const none = { doi: null, arxiv_id: null, limited: false };
  if (q.length < 15) return none;
  let r;
  try {
    r = await fetch('https://dblp.org/search/publ/api/?' + new URLSearchParams({ q, format: 'json', h: '3' }));
  } catch { return none; }
  if (!r.ok) return r.status === 429 ? { doi: null, arxiv_id: null, limited: true } : none;
  let hits;
  try { hits = ((((await r.json()).result || {}).hits || {}).hit || []); } catch { return none; }
  const nEntry = norm(entryRaw);
  for (const h of hits) {
    const info = h.info || {};
    const title = String(info.title || '').replace(/<[^>]*>/g, '');
    if (norm(title).length < 10) continue;
    if (!nEntry.includes(norm(title))) continue;
    if (entryYear && info.year && Math.abs(+info.year - entryYear) > 1) continue;
    if (info.doi) return { doi: String(info.doi), arxiv_id: null, limited: false };
  }
  return none;
}
async function verifyDoi(doi) {
  const miss = { exists: false, title: null, authors: [], venue: '', year: '', retracted: false, limited: false };
  let limited = false;
  for (const fn of [pgCheckCrossRef, pgCheckDataCite, pgCheckEuropePMC]) {
    let hit = null;
    try { hit = await fn(doi); } catch { hit = null; }
    if (hit && hit.limited) { limited = true; continue; }
    if (hit) return {
      exists: true, title: hit.title, authors: hit.authors || [],
      venue: hit.venue || '', year: hit.year || '',
      retracted: !!hit.retracted, limited: false,
    };
  }
  return limited ? Object.assign({}, miss, { limited: true }) : miss;
}
async function verifyArxiv(id) {
  const base = id.replace(/v\d+$/i, '');
  let hit = null;
  try { hit = await pgCheckDataCite('10.48550/arXiv.' + base); } catch { hit = null; }
  if (hit && hit.limited)
    return { exists: false, title: null, authors: [], venue: '', year: '', retracted: false, limited: true };
  return hit
    ? { exists: true, title: hit.title, authors: hit.authors || [], venue: 'arXiv preprint', year: hit.year || '', retracted: !!hit.retracted, limited: false }
    : { exists: false, title: null, authors: [], venue: '', year: '', retracted: false, limited: false };
}

async function resolveCitation(pair, refmap, cache) {
  const key = pair.cite_type + '|' + pair.cite_id;
  if (cache.has(key)) return cache.get(key);
  const t = pair.cite_type, cid = pair.cite_id;
  let out;
  /* fabricated: an explicit identifier (DOI / arXiv ID) was checked against
   * its authoritative registry and positively does NOT exist. That is evidence
   * of fabrication, not mere absence of evidence — hence a label of its own,
   * never folded into UNVERIFIED. */
  const wrap = (res, doi, arxivId, note, extra) => {
    const claimed = doi || arxivId || null;
    return {
      exists: res.exists, title: res.title, doi: res.exists ? doi : null,
      arxiv_id: res.exists ? arxivId : null,
      authors: res.authors || [], venue: res.venue || '', year: res.year || '',
      limited: !!res.limited, retracted: !!res.retracted,
      chimeric: !!(extra && extra.chimeric),
      fabricated: !res.exists && !res.limited && !!claimed,
      claimed,
      note };
  };
  if (t === 'doi') {
    out = wrap(await verifyDoi(cid), cid, null, 'raw DOI in text');
  } else if (t === 'arxiv') {
    out = wrap(await verifyArxiv(cid), '10.48550/arXiv.' + cid.replace(/v\d+$/i, ''), cid, 'raw arXiv ID in text');
  } else if (t === 'url' && cid.includes('doi.org')) {
    const doi = cid.split('doi.org/')[1];
    out = wrap(await verifyDoi(doi), doi, null, 'doi.org URL in text');
  } else if (t === 'numeric' || t === 'citekey' || t === 'author-year') {
    const rm = await resolveMarker(t, cid, refmap);
    if (rm.doi) {
      const v = await verifyDoi(rm.doi);
      out = wrap(v, rm.doi, null, `reference-list (${rm.via}): ${rm.note}`,
        { chimeric: detectChimeric(rm.entryRaw, v.authors) });
    } else if (rm.arxiv_id) {
      const v = await verifyArxiv(rm.arxiv_id);
      out = wrap(v, '10.48550/arXiv.' + rm.arxiv_id.replace(/v\d+$/i, ''), rm.arxiv_id,
        `reference-list (${rm.via}): ${rm.note}`,
        { chimeric: detectChimeric(rm.entryRaw, v.authors) });
    } else out = { exists: false, title: null, doi: null, arxiv_id: null,
      authors: [], venue: '', year: '', limited: !!rm.limited,
      retracted: false, chimeric: false, fabricated: false, claimed: null,
      note: 'reference-list: ' + rm.note };
  } else {
    out = { exists: false, title: null, doi: null, arxiv_id: null,
      authors: [], venue: '', year: '', limited: false,
      retracted: false, chimeric: false, fabricated: false, claimed: null,
      note: `marker type '${t}' is not resolvable` };
  }
  cache.set(key, out);
  return out;
}

/* ---------------- abstract ---------------- */

async function fetchAbstract(res) {
  if (res.arxiv_id) {
    const d = await pgCheckDataCite('10.48550/arXiv.' + res.arxiv_id.replace(/v\d+$/i, '')).catch(() => null);
    // DataCite descriptions need the full record; fetch it
    try {
      const r = await fetch('https://api.datacite.org/dois/' + encodeURIComponent('10.48550/arXiv.' + res.arxiv_id.replace(/v\d+$/i, '')),
        { headers: { Accept: 'application/vnd.api+json' } });
      if (r.ok) {
        const descs = ((await r.json()).data.attributes.descriptions || [])
          .filter(d => (d.descriptionType || '').toLowerCase() === 'abstract');
        if (descs.length) return descs[0].description.trim();
      }
    } catch { /* fall through */ }
  }
  if (res.doi) {
    try {
      const r = await fetch('https://api.semanticscholar.org/graph/v1/paper/DOI:' +
        encodeURIComponent(res.doi) + '?fields=title,abstract');
      if (r.ok) {
        const ab = (await r.json()).abstract;
        if (ab && ab.trim()) return ab.trim();
      }
    } catch { /* fall through */ }
    try {
      const epmc = await pgCheckEuropePMC(res.doi);
      if (epmc && epmc.abstract) return epmc.abstract;
    } catch { /* fall through */ }
  }
  return null;
}

/* ---------------- LLM judgment (BYOK) ---------------- */

const JUDGE_SYSTEM = `You judge whether a paper ABSTRACT substantively supports a CLAIM from a draft.
Reply with exactly two lines:
VERDICT: SUPPORTED | PARTIAL | UNSUPPORTED | NO_ABSTRACT
REASON: one sentence, no more than 25 words.
Rules: SUPPORTED only if the abstract directly states or clearly entails the claim's key assertion. PARTIAL if topically related but the key assertion is not in the abstract. UNSUPPORTED if the abstract contradicts it or is about something else. NO_ABSTRACT if no abstract was provided. Never invent content beyond the abstract.`;

async function judgeSupport(claim, abstract, title, apiKey, model) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 60000);
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: model || 'openai/gpt-4o-mini', temperature: 0.2, max_tokens: 200,
        messages: [
          { role: 'system', content: JUDGE_SYSTEM },
          { role: 'user', content: `TITLE: ${title || '(unknown)'}\nABSTRACT: ${abstract}\nCLAIM: ${claim}` },
        ],
      }),
    });
    if (!r.ok) return { verdict: 'error', reason: `LLM request failed (HTTP ${r.status}) — downgraded honestly` };
    const text = ((await r.json()).choices[0].message.content || '').trim();
    const vm = /VERDICT:\s*(SUPPORTED|PARTIAL|UNSUPPORTED|NO_ABSTRACT)/i.exec(text);
    const rm = /REASON:\s*(.+)/is.exec(text);
    const reason = rm ? rm[1].trim().split('\n')[0].slice(0, 200) : '';
    if (!vm) return { verdict: 'error', reason: 'unparseable LLM output — downgraded honestly' };
    return { verdict: vm[1].toUpperCase(), reason };
  } catch (e) {
    return { verdict: 'error', reason: 'LLM request failed — downgraded honestly' };
  } finally { clearTimeout(to); }
}

/* ---------------- freshness ---------------- */

function checkFreshness(claim, windowYears) {
  windowYears = windowYears || 3;
  YEAR_RE.lastIndex = 0;
  const years = [];
  let m;
  while ((m = YEAR_RE.exec(claim))) years.push(parseInt(m[1], 10));
  if (!years.length) return { stale: false, tag: '' };
  const newest = Math.max(...years);
  const age = new Date().getFullYear() - newest;
  return age > windowYears ? { stale: true, tag: `[STALE:${newest}]` } : { stale: false, tag: '' };
}

/* No-key heuristic: neutral keyword-overlap measurement between the claim and
 * the abstract. It is a number, not a judgment — the label stays CITED and the
 * author decides. Never presented as VERIFIED. */
const VP_STOP = new Set(('a,an,the,and,or,but,if,then,else,when,while,of,at,by,for,with,about,into,through,during,before,after,above,below,to,from,up,down,in,out,on,off,over,under,again,further,once,here,there,all,any,both,each,few,more,most,other,some,such,no,nor,not,only,own,same,so,than,too,very,can,will,just,should,now,is,are,was,were,be,been,being,have,has,had,having,do,does,did,doing,would,could,ought,i,you,he,she,it,we,they,them,his,her,its,our,their,this,that,these,those,as,also,which,who,whom,what,where,why,how,because,until,between,among,per,via,using,used,use,based,et,al').split(','));
function vpTokens(s) {
  return (String(s || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [])
    .map(t => (t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t))
    .filter(t => !VP_STOP.has(t));
}
function keywordOverlap(claim, abstract) {
  const ck = vpTokens(claim);
  if (!ck.length) return null;
  const ak = new Set(vpTokens(abstract));
  if (!ak.size) return null;
  const hit = ck.filter(t => ak.has(t)).length;
  return hit / ck.length;
}
function heuristicSupportHint(claim, abstract) {
  const r = keywordOverlap(claim, abstract);
  if (r == null) return null;
  const pct = Math.round(r * 100);
  const band = r >= 0.45 ? 'strong' : r >= 0.25 ? 'partial' : 'weak';
  return `heuristic: ${band} keyword overlap (${pct}% of claim keywords appear in the abstract) — a number, not a verdict; author decides`;
}

/* ---------------- pipeline ---------------- */

/* Claims are checked with bounded concurrency (4 at a time): the old
 * sequential loop with a 350ms sleep made a 20-claim draft take ~10 minutes.
 * The shared cache is a plain Map — concurrent duplicate fetches are possible
 * but harmless (same result, just redundant work). */
const GROUND_CONCURRENCY = 4;
async function groundDraft(text, opts, onStep) {
  opts = opts || {};
  const pairs = extractPairs(text);
  const refmap = parseReferences(text);
  const cache = new Map();
  const evidence = new Array(pairs.length);
  let next = 0, done = 0;
  async function checkOne(i) {
    const p = pairs[i];
    const res = await resolveCitation(p, refmap, cache);
    let base = 'UNVERIFIED', note = res.note;
    if (res.exists) {
      const ab = await fetchAbstract(res);
      if (opts.apiKey && ab) {
        const j = await judgeSupport(p.claim, ab, res.title, opts.apiKey, opts.model);
        if (j.verdict === 'SUPPORTED') { base = 'VERIFIED'; note = j.reason; }
        else if (j.verdict === 'PARTIAL') { base = 'CITED'; note = 'partial support only — author decides (' + j.reason + ')'; }
        else { base = 'CITED'; note = j.reason || 'abstract does not support the claim — author decides'; }
      } else {
        base = 'CITED';
        if (!opts.apiKey && ab) {
          const hint = heuristicSupportHint(p.claim, ab);
          note = (hint || 'no LLM key provided — support not checked') +
            ' (add an OpenRouter key above for a real content judgment)';
        } else {
          note = !opts.apiKey
            ? 'no LLM key provided — support not checked (add an OpenRouter key above for content judgment)'
            : 'no abstract available — downgraded honestly';
        }
      }
      if (res.retracted) {
        if (base === 'VERIFIED') base = 'CITED';  // a retracted paper verifies nothing
        note = 'RETRACTED paper — do not cite it as support. ' + note;
      }
      if (res.chimeric) {
        note = 'CHIMERIC citation: the title matches a real paper but the listed authors do not — ' + note;
      }
    } else if (res.limited) {
      // rate-limited is NOT not-found: say so explicitly, never imply fabrication
      base = 'RATE_LIMITED';
      note = 'source(s) rate-limited (HTTP 429) while checking — not checked, NOT proven fake. Try again later.';
    } else if (res.fabricated) {
      base = 'FABRICATED';
      const id = res.claimed || '';
      const what = /^10\./.test(id) ? 'DOI ' + id
        : /^\d{4}\./.test(id) || /^arXiv:/i.test(id) ? 'arXiv ID ' + id.replace(/^10\.48550\/arXiv\./i, '')
        : 'identifier ' + id;
      note = `${what} checked against its registry and does not exist — fabricated or mistyped; do not cite.`;
    }
    const fr = checkFreshness(p.claim, opts.windowYears);
    const tags = [
      fr.stale ? fr.tag : '',
      res.chimeric ? '[CHIMERIC:author-mismatch]' : '',
      res.retracted ? '[RETRACTED]' : '',
    ].filter(Boolean);
    evidence[i] = {
      claim: p.claim, base,
      label: base + (tags.length ? ' ' + tags.join(' ') : ''),
      doi: res.doi || '', arxiv_id: res.arxiv_id || '', title: res.title || '', note,
      authors: res.authors || [], venue: res.venue || '', year: res.year || '',
    };
    done++;
    if (onStep) onStep(`Checking claim ${done}/${pairs.length}…`);
    await sleep(150);
  }
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= pairs.length) return;
      await checkOne(i);
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(GROUND_CONCURRENCY, pairs.length); w++) workers.push(worker());
  await Promise.all(workers);
  return evidence;
}

/* ---------------- BibTeX export ---------------- */

function bibEscape(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/([{}])/g, '\\$1');
}
function evidenceToBibTeX(evidence) {
  const seen = new Set();
  const entries = [];
  for (const e of evidence) {
    if (!e.title) continue;
    const id = String(e.doi || e.arxiv_id || e.title).toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    const key = 'veripaper' + String(entries.length + 1).padStart(3, '0');
    const authors = (e.authors || []).join(' and ');
    const venue = e.venue || '';
    const isProc = /proceeding|conference|workshop|symposium|neural information processing|neurips|icml|iclr|aaai|acl|emnlp|naacl|cvpr|iccv|eccv|kdd|www|sigir|chi/i.test(venue);
    const type = isProc ? 'inproceedings' : venue ? 'article' : 'misc';
    const lines = [`@${type}{${key},`];
    lines.push(`  title = {${bibEscape(e.title)}},`);
    if (authors) lines.push(`  author = {${bibEscape(authors)}},`);
    if (isProc) lines.push(`  booktitle = {${bibEscape(venue)}},`);
    else if (venue) lines.push(`  journal = {${bibEscape(venue)}},`);
    if (e.year) lines.push(`  year = {${e.year}},`);
    if (e.doi) lines.push(`  doi = {${e.doi}},`);
    else if (e.arxiv_id) lines.push(`  eprint = {${e.arxiv_id}},`, `  archivePrefix = {arXiv},`);
    lines.push(`  note = {grounded by veripaper: ${(e.base || 'CITED').toLowerCase()}}`);
    lines.push('}');
    entries.push(lines.join('\n'));
  }
  return entries.join('\n\n');
}

/* ---------------- UI ---------------- */

const SAMPLE = `# Sample draft

Transformers changed NLP forever [1]. Deep learning is described as a breakthrough (LeCun et al., 2015).

Phishing remains common (Verizon, 2023). This claim cites nothing and stays unverified.

## References

[1] Vaswani, A., et al. Attention is all you need. NeurIPS 2017. arXiv:1706.03762.

LeCun, Y., Bengio, Y., Hinton, G. Deep learning. Nature 521:436-444, 2015.

Verizon. 2023 Data Breach Investigations Report. 2023.`;

function labelClass(base) {
  return { VERIFIED: 'l-verified', CITED: 'l-cited', UNVERIFIED: 'l-unverified',
    RATE_LIMITED: 'l-stale', FABRICATED: 'l-unverified' }[base] || 'l-cited';
}

function renderReport(evidence) {
  const counts = { VERIFIED: 0, CITED: 0, UNVERIFIED: 0, RATE_LIMITED: 0, FABRICATED: 0 };
  let staleN = 0, chimericN = 0, retractedN = 0;
  for (const e of evidence) {
    counts[e.base] = (counts[e.base] || 0) + 1;
    if (/\[STALE:/.test(e.label)) staleN++;
    if (/\[CHIMERIC/.test(e.label)) chimericN++;
    if (/\[RETRACTED\]/.test(e.label)) retractedN++;
  }
  let html = `<div style="margin-bottom:18px;font-size:14.5px">` +
    `<b>${evidence.length}</b> claims checked &nbsp;·&nbsp; ` +
    `<span class="label l-verified">VERIFIED ${counts.VERIFIED}</span> ` +
    `<span class="label l-cited">CITED ${counts.CITED}</span> ` +
    `<span class="label l-unverified">UNVERIFIED ${counts.UNVERIFIED}</span>` +
    (counts.RATE_LIMITED ? ` <span class="label l-stale">RATE_LIMITED ${counts.RATE_LIMITED}</span>` : '') +
    (counts.FABRICATED ? ` <span class="label l-unverified">FABRICATED ${counts.FABRICATED}</span>` : '') +
    (staleN ? ` <span class="label l-stale">STALE ×${staleN}</span>` : '') +
    (chimericN ? ` <span class="label l-unverified">CHIMERIC ×${chimericN}</span>` : '') +
    (retractedN ? ` <span class="label l-unverified">RETRACTED ×${retractedN}</span>` : '') +
    `</div>`;
  evidence.forEach((e, i) => {
    const tags = e.label.split(' ').slice(1).map(t =>
      `<span class="label ${/CHIMERIC|RETRACTED/.test(t) ? 'l-unverified' : 'l-stale'}">${gesc(t)}</span>`).join(' ');
    html += `<div class="claim open" style="cursor:default">` +
      `<p><b>${i + 1}.</b> ${gesc(e.claim)}</p>` +
      `<div class="verdict" style="display:block">` +
      `<span class="label ${labelClass(e.base)}">${gesc(e.base)}</span>` +
      (tags ? ' ' + tags : '') +
      (e.title ? `<div style="margin:8px 0 4px"><b>${gesc(e.title)}</b></div>` : '') +
      (e.doi ? `<div style="color:var(--ink-soft);font-size:13px">DOI: ${gesc(e.doi)}</div>` : '') +
      `<div style="margin-top:6px;color:var(--ink-soft)">${gesc(e.note)}</div>` +
      `</div></div>`;
  });
  html += `<p style="font-size:12.5px;color:var(--ink-soft);margin-top:14px">` +
    `Labels: VERIFIED = abstract substantively supports the claim; CITED = source exists but support is uncertain/unchecked (author decides); ` +
    `UNVERIFIED = no record found or marker not resolvable (absence of evidence, not evidence of fabrication); ` +
    `FABRICATED = identifier checked against its registry and found not to exist — fabricated or mistyped; ` +
    `RATE_LIMITED = sources were rate-limited while checking — not checked, NOT proven fake; ` +
    `[STALE:YYYY] = data older than the freshness window; ` +
    `[CHIMERIC:author-mismatch] = title matches a real paper but the listed authors do not; ` +
    `[RETRACTED] = the paper has been retracted — do not cite it as support.</p>`;
  return html;
}

function initGround() {
  const ta = document.getElementById('ground-input');
  const key = document.getElementById('ground-key');
  const btn = document.getElementById('ground-btn');
  const sample = document.getElementById('ground-sample');
  const prog = document.getElementById('ground-progress');
  const out = document.getElementById('ground-result');
  if (!ta) return;
  sample.addEventListener('click', () => { ta.value = SAMPLE; });
  // 30-second demo: load the sample, run it, scroll to results
  const demo = document.getElementById('demo-btn');
  if (demo) demo.addEventListener('click', () => {
    ta.value = SAMPLE;
    const sec = document.getElementById('ground');
    if (sec && sec.scrollIntoView) sec.scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => btn.click(), 650);
  });
  btn.addEventListener('click', async () => {
    const text = ta.value.trim();
    if (!text) { out.innerHTML = '<p style="color:var(--ink-soft)">Paste your draft first — or load the sample.</p>'; return; }
    btn.disabled = true;
    btn.textContent = 'Grounding…';
    out.innerHTML = '';
    prog.textContent = 'Extracting claims…';
    try {
      const evidence = await groundDraft(text,
        { apiKey: key.value.trim() || null },
        s => { prog.textContent = s; });
      prog.textContent = '';
      // export toolbar FIRST: BibTeX download (Zotero/Mendeley/LaTeX-ready) + DOI list
      const bar = document.createElement('div');
      bar.className = 'btnrow';
      bar.id = 'expbar';
      bar.innerHTML = `<button id="exp-bib" class="btn ghost">Export BibTeX (.bib)</button>
        <button id="exp-doi" class="btn ghost">Copy DOI list</button>
        <span class="hint" style="margin:0">.bib imports directly into Zotero / Mendeley / JabRef</span>`;
      out.innerHTML = '';
      out.appendChild(bar);
      const rep = document.createElement('div');
      rep.innerHTML = renderReport(evidence);
      out.appendChild(rep);
      if (window.VP) { try { VP.recordGround(evidence); } catch {} }
      try {
        document.getElementById('exp-bib').addEventListener('click', () => {
          const bib = evidenceToBibTeX(evidence);
          if (!bib.trim()) { document.getElementById('exp-bib').textContent = 'Nothing to export'; return; }
          const blob = new Blob([bib], { type: 'text/plain' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'veripaper-references.bib';
          document.body.appendChild(a); a.click();
          setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
        });
        document.getElementById('exp-doi').addEventListener('click', () => {
          const dois = [...new Set(evidence.map(e => e.doi).filter(Boolean))];
          if (!dois.length) return;
          navigator.clipboard.writeText(dois.join('\n')).then(
            () => { document.getElementById('exp-doi').textContent = 'Copied'; },
            () => { document.getElementById('exp-doi').textContent = 'Copy failed'; });
        });
      } catch { /* export is best-effort */ }
    } catch (err) {
      prog.textContent = '';
      out.innerHTML = `<p style="color:var(--red)">Something failed: ${gesc(err.message || err)}. Your draft never left this page — try again.</p>`;
    }
    btn.disabled = false;
    btn.textContent = 'Ground this draft';
  });
}

if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', initGround);
else
  initGround();
