/* veripaper — BibTeX entry point (client-side only).
 *
 * A .bib file (uploaded or pasted) is parsed here, in the browser, and turned
 * into an ordinary reference list: one `[@key] Authors. Title. Venue, Year.
 * doi:… arXiv:…` line per entry plus one marker sentence per entry. That text
 * then goes through the exact same grounding pipeline as a draft
 * (groundDraft in ground.js), so every entry gets the same labels —
 * CITED / UNVERIFIED / FABRICATED / RATE_LIMITED + [CHIMERIC] / [RETRACTED] —
 * via the same DOI / arXiv / title lookups. Nothing is uploaded anywhere: the
 * only network traffic is the registry lookups the draft checker already makes.
 *
 * A .bib has no claims, so bib mode is existence-level only: no claim-support
 * judgment and no freshness tags (see groundDraft opts.bibMode).
 */

/* ---------------- parser ---------------- */

function _bibReadValue(s, i, strings) {
  // returns [value, nextIndex]; handles {…} (nested), "…", bare numbers/macros, and # concatenation
  let out = '';
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    const c = s[i];
    if (c === '{') {
      let depth = 0, j = i;
      for (; j < s.length; j++) {
        if (s[j] === '\\') { j++; continue; }
        if (s[j] === '{') depth++;
        else if (s[j] === '}') { depth--; if (depth === 0) break; }
      }
      out += s.slice(i + 1, j);
      i = j + 1;
    } else if (c === '"') {
      let depth = 0, j = i + 1;
      for (; j < s.length; j++) {
        if (s[j] === '\\') { j++; continue; }
        if (s[j] === '{') depth++;
        else if (s[j] === '}') depth--;
        else if (s[j] === '"' && depth === 0) break;
      }
      out += s.slice(i + 1, j);
      i = j + 1;
    } else {
      const m = /^[^\s,#}]+/.exec(s.slice(i));
      const tok = m ? m[0] : '';
      out += /^\d+$/.test(tok) ? tok : (strings[tok.toLowerCase()] !== undefined ? strings[tok.toLowerCase()] : tok);
      i += tok.length || 1;
    }
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] === '#') { i++; continue; }
    break;
  }
  return [out, i];
}

function _bibFields(body, strings) {
  const fields = {};
  let i = 0;
  while (i < body.length) {
    const m = /^[\s,]*([A-Za-z][\w\-:.]*)\s*=/.exec(body.slice(i));
    if (!m) break;
    i += m[0].length;
    const [val, j] = _bibReadValue(body, i, strings);
    fields[m[1].toLowerCase()] = val.replace(/\s+/g, ' ').trim();
    i = j;
  }
  return fields;
}

/* Returns [{ key, type, fields }] — @comment / @preamble skipped, @string
 * macros expanded. Malformed entries are reported in `errors`, never guessed. */
function parseBibTeX(text) {
  const s = String(text || '');
  const entries = [], errors = [];
  const strings = { jan: 'January', feb: 'February', mar: 'March', apr: 'April', may: 'May', jun: 'June',
    jul: 'July', aug: 'August', sep: 'September', oct: 'October', nov: 'November', dec: 'December' };
  const re = /@\s*([A-Za-z]+)\s*([{(])/g;
  let m;
  while ((m = re.exec(s))) {
    const type = m[1].toLowerCase();
    const open = m[2], close = open === '{' ? '}' : ')';
    let depth = 0, j = m.index + m[0].length - 1;
    for (; j < s.length; j++) {
      if (s[j] === '\\') { j++; continue; }
      if (s[j] === open || (open === '(' && s[j] === '{')) depth++;
      else if (s[j] === close || (open === '(' && s[j] === '}')) { depth--; if (depth === 0) break; }
    }
    if (j >= s.length) { errors.push(`unterminated @${type} entry at offset ${m.index}`); break; }
    const body = s.slice(m.index + m[0].length, j);
    re.lastIndex = j + 1;
    if (type === 'comment' || type === 'preamble') continue;
    if (type === 'string') {
      const f = _bibFields(body, strings);
      Object.keys(f).forEach(k => { strings[k] = f[k]; });
      continue;
    }
    const km = /^\s*([^,\s]+)\s*,/.exec(body);
    if (!km) { errors.push(`@${type} entry without a citation key at offset ${m.index}`); continue; }
    entries.push({ key: km[1], type, fields: _bibFields(body.slice(km[0].length), strings) });
  }
  return { entries, errors };
}

/* Pasted text is treated as BibTeX only when it starts like a .bib file (an
 * @type{ / @type( possibly after % comment lines) and holds at least one keyed entry. */
function looksLikeBibTeX(text) {
  const t = String(text || '');
  return /^\s*(%[^\n]*\n\s*)*@\s*[A-Za-z]+\s*[{(]/.test(t) &&
    /@\s*[A-Za-z]+\s*[{(]\s*[^,\s={}()]+\s*,/.test(t);
}

/* ---------------- LaTeX → plain text ---------------- */

const _BIB_ACCENTS = {
  '"': { a: 'ä', o: 'ö', u: 'ü', e: 'ë', i: 'ï', A: 'Ä', O: 'Ö', U: 'Ü' },
  "'": { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', c: 'ć', n: 'ń', s: 'ś', z: 'ź', E: 'É', A: 'Á' },
  '`': { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù' },
  '^': { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û' },
  '~': { n: 'ñ', a: 'ã', o: 'õ', N: 'Ñ' },
  'c': { c: 'ç', C: 'Ç' },
  'v': { c: 'č', s: 'š', z: 'ž', r: 'ř', e: 'ě', C: 'Č', S: 'Š', Z: 'Ž' },
};
function bibCleanLatex(v) {
  let s = String(v || '');
  s = s.replace(/\\([" '`^~cv])\s*\{?\\?([A-Za-z])\}?/g, (all, acc, ch) =>
    (_BIB_ACCENTS[acc] && _BIB_ACCENTS[acc][ch]) || ch);
  s = s.replace(/\\ss\b\s*/g, 'ß').replace(/\\o\b\s*/g, 'ø').replace(/\\aa\b\s*/g, 'å')
    .replace(/\\&/g, '&').replace(/\\%/g, '%').replace(/\\_/g, '_').replace(/~/g, ' ')
    .replace(/-{2,3}/g, '-');
  s = s.replace(/\\(?:emph|textit|textbf|textsc|mathrm|mathbf|text)\s*\{([^{}]*)\}/g, '$1');
  s = s.replace(/\\[A-Za-z]+\s*/g, '').replace(/[{}$]/g, '');
  return s.replace(/\s+/g, ' ').trim();
}

/* "He, Kaiming and Zhang, Xiangyu and others" → "He, K., Zhang, X., et al."
 * (the Surname, I. shape the chimeric check keys on). */
function bibAuthorsToRef(author) {
  const names = bibCleanLatex(author).split(/\s+and\s+/i).map(n => n.trim()).filter(Boolean);
  let etal = false;
  const out = [];
  for (const n of names) {
    if (/^others$/i.test(n)) { etal = true; continue; }
    let last, first;
    if (n.includes(',')) { const p = n.split(','); last = p[0].trim(); first = p.slice(1).join(' ').trim(); }
    else {
      const p = n.split(/\s+/);
      // keep lowercase particles with the surname: "Ludwig van Beethoven" → "van Beethoven"
      let k = p.length - 1;
      while (k > 0 && /^(van|von|der|de|del|della|di|da|le|la|du|dos|ter|den)$/.test(p[k - 1])) k--;
      last = p.slice(k).join(' '); first = p.slice(0, k).join(' ');
    }
    // "Ming-Wei" → "M.-W.", "M.-W." stays "M.-W.", "J. D." → "J. D."
    const initials = first.split(/\s+/).filter(Boolean)
      .map(w => w.split('-').map(x => x.replace(/[^A-Za-z\u00C0-\u024F]/g, ''))
        .filter(Boolean).map(x => x[0].toUpperCase() + '.').join('-'))
      .filter(Boolean).join(' ');
    out.push(initials ? `${last}, ${initials}` : last);
  }
  if (!out.length) return '';
  return out.join(', ') + (etal ? ', et al.' : '');
}

function _bibArxivId(f) {
  const ep = f.eprint || '';
  const ap = (f.archiveprefix || f.eprinttype || '').toLowerCase();
  const m1 = /(\d{4}\.\d{4,5}(?:v\d+)?|[a-z\-]+(?:\.[A-Z]{2})?\/\d{7}(?:v\d+)?)/.exec(ep);
  if (m1 && (ap === 'arxiv' || /^\d{4}\.\d{4,5}/.test(ep))) return m1[1];
  for (const v of [f.url, f.journal, f.note, f.howpublished]) {
    const m = /arxiv(?:\.org\/(?:abs|pdf)\/|[:\s]+)\s*(\d{4}\.\d{4,5}(?:v\d+)?)/i.exec(v || '');
    if (m) return m[1];
  }
  return null;
}
function _bibDoi(f) {
  for (const v of [f.doi, f.url]) {
    const m = /(10\.\d{4,9}\/[^\s"<>{}]+)/.exec(v || '');
    if (m) return m[1].replace(/[.,;]+$/, '');
  }
  return null;
}

/* One reference-list line in the shape parseReferences/entryIds understand. */
function bibEntryToRefLine(e) {
  const f = e.fields || {};
  const parts = [];
  const au = bibAuthorsToRef(f.author || f.editor || '');
  if (au) parts.push(au.replace(/\.$/, '') + '.');
  const title = bibCleanLatex(f.title || '').replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (title) parts.push(title + '.');
  const venue = bibCleanLatex(f.journal || f.booktitle || f.howpublished || f.publisher || f.institution || f.school || '');
  const year = (/\b(1[5-9]\d{2}|20\d{2})\b/.exec(f.year || f.date || '') || [])[1] || '';
  const vy = (year && venue.includes(year) ? [venue] : [venue, year]).filter(Boolean).join(', ');
  if (vy) parts.push(vy + '.');
  const doi = _bibDoi(f), arxiv = _bibArxivId(f);
  if (doi) parts.push('doi:' + doi);
  if (arxiv && !(doi && doi.toLowerCase().includes(arxiv.toLowerCase())) && !vy.includes(arxiv))
    parts.push('arXiv:' + arxiv);
  // a line that starts with "[n]" or "#" would be mis-split by the reference parser
  return parts.join(' ').replace(/\s+/g, ' ').replace(/^[#\[]+/, '').trim();
}

/* .bib text → { draft, entries, errors, skipped }.
 * draft = one marker sentence per entry + a References section. */
function bibToDraft(text) {
  const { entries, errors } = parseBibTeX(text);
  const seen = new Set(), kept = [], skipped = [];
  for (const e of entries) {
    const safeKey = /^[^\s\]\[;,@]+$/.test(e.key) ? e.key : null;
    if (!safeKey) { skipped.push({ key: e.key, reason: 'citation key has characters a marker cannot carry' }); continue; }
    if (seen.has(e.key)) { skipped.push({ key: e.key, reason: 'duplicate key' }); continue; }
    seen.add(e.key);
    kept.push(e);
  }
  const body = kept.map(e => `BibTeX entry [@${e.key}].`).join('\n');
  const refs = kept.map(e => `[@${e.key}] ${bibEntryToRefLine(e)}`).join('\n\n');
  const draft = kept.length ? `${body}\n\n## References\n\n${refs}\n` : '';
  return { draft, entries: kept, errors, skipped };
}

/* Evidence (from groundDraft over a bibToDraft draft) → per-entry display rows. */
function bibLabelEvidence(evidence, entries) {
  const byKey = {};
  (entries || []).forEach(e => { byKey[e.key] = e; });
  return (evidence || []).map(ev => {
    const m = /\[@([^\]]+)\]/.exec(ev.claim || '');
    const e = m && byKey[m[1]];
    if (!e) return ev;
    const t = bibCleanLatex(e.fields.title || '') || '(no title in entry)';
    const rawDoi = String(e.fields.doi || '').trim();
    if (rawDoi && !_bibDoi({ doi: rawDoi })) {
      // a DOI field that is not a well-formed DOI: flag it, never silently ignore it
      return Object.assign({}, ev, { claim: `@${e.key} — ${t}`, bibkey: e.key, base: 'INVALID_DOI', label: 'INVALID_DOI',
        doi: '', note: `DOI format invalid: '${rawDoi}' is not a well-formed DOI (10.<4-9 digits>/<suffix>) — likely mistyped or fabricated. Fix or remove it.` });
    }
    return Object.assign({}, ev, { claim: `@${e.key} — ${t}`, bibkey: e.key });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseBibTeX, looksLikeBibTeX, bibCleanLatex, bibAuthorsToRef,
    bibEntryToRefLine, bibToDraft, bibLabelEvidence };
}
