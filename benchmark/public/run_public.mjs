#!/usr/bin/env node
/* Run veripaper's WEB pipeline (web/ground.js + web/bibtex.js — the code the
 * live site runs) over public, openly licensed, labelled hallucinated-citation
 * datasets. Existence / metadata level only: these datasets label references,
 * not claims, so every item is checked the way the site checks a pasted .bib
 * (groundDraft with bibMode: no abstract fetch, no claim-support model).
 *
 *   ./fetch_datasets.sh                       # downloads into ./data (licences: README.md)
 *   node run_public.mjs <dataset> [--per N] [--seed S] [--out name]
 *     dataset: badalova | citeme | citetracer | iclr
 *     --per N  stratified random sample, N items per label/subtype (default: all)
 *     --seed S sampling seed (default 20261021)
 *
 * Each item gets a fresh vm context (empty cache, no cooldown state), as in
 * comparison/run_veripaper_web.mjs. Items whose verdict is RATE_LIMITED (or an
 * error) are retried after 90 s and 240 s; every attempt is kept.
 * Results stream to results/<out>.jsonl (resumable) and are summarised into
 * results/<out>.json by score_public.py.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DATA = path.join(HERE, 'data');
const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const perRaw = opt('--per', null);
const perArg = perRaw ? parseInt(perRaw, 10) : null;
const SEED = parseInt(opt('--seed', '20261021'), 10);
const OUTNAME = opt('--out', null);
const dataset = args[0];
const RETRY_PAUSES = [90, 240];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, '+00:00');
const SRC = fs.readFileSync(path.join(ROOT, 'web', 'bibtex.js'), 'utf8') + '\n' +
  fs.readFileSync(path.join(ROOT, 'web', 'ground.js'), 'utf8');

/* ---------- deterministic sampling ---------- */
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function sampleStrata(items, per, seed) {
  if (!per) return items;
  const rnd = mulberry32(seed), by = {};
  for (const it of items) (by[it.stratum] = by[it.stratum] || []).push(it);
  const out = [];
  for (const k of Object.keys(by).sort()) {
    const a = by[k].slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    out.push(...a.slice(0, per));
  }
  return out;
}

/* ---------- dataset adapters → {id, stratum, truth: 'problem'|'ok'|'corrupted', input: {ref}|{bib}} ---------- */
function csvParse(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift();
  return rows.filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const bibEsc = (s) => String(s == null ? '' : s).replace(/[{}]/g, '');
function recordToBib(key, r) {
  const f = [];
  const add = (k, v) => { if (v !== undefined && v !== null && String(v).trim() !== '') f.push(`  ${k} = {${bibEsc(v)}}`); };
  add('title', r.title);
  add('author', (r.authors || []).map(a => /^(others|et al\.?)$/i.test(String(a).trim()) ? 'others' : a).join(' and '));
  add(/proceedings|conference|workshop|symposium|^[A-Z]{2,}[\s\d]*$/i.test(r.venue || '') ? 'booktitle' : 'journal', r.venue);
  add('year', r.year); add('volume', r.volume); add('pages', r.pages); add('publisher', r.publisher);
  add('doi', r.doi);
  if (r.arxiv_id) { add('eprint', r.arxiv_id); add('archiveprefix', 'arXiv'); }
  add('url', r.url);
  return `@misc{${key},\n${f.join(',\n')}\n}\n`;
}
function loadDataset(name) {
  if (name === 'badalova') {
    // the CSV is not valid UTF-8 (mixed Windows-1252 bytes); latin1 keeps every byte, ASCII content is unaffected
    const rows = csvParse(fs.readFileSync(path.join(DATA, 'badalova_mayr_2026.csv'), 'latin1'));
    return rows.map(r => ({ id: `${r.document_id}-${r.reference_number}`, stratum: r.manual_label,
      truth: r.manual_label === 'problematic' ? 'problem' : 'ok', input: { ref: r.reference.trim() },
      published: { checkifexist: r.checkifexist, hallucitechecker: r.hallucitechecker, hallucinator: r.hallucinator, halref: r.halref, refchecker: r.refchecker } }));
  }
  if (name === 'citeme') {
    const out = [];
    for (const line of fs.readFileSync(path.join(DATA, 'citeme-corpus-v1.jsonl'), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const c = JSON.parse(line);
      for (const r of c.refs) out.push({ id: r.ref_id, stratum: r.class + (r.sub_label ? ':' + r.sub_label : ''),
        truth: r.class === 'FABRICATED' ? 'problem' : (r.class === 'EXISTS_CORRECT' ? 'ok' : 'corrupted'),
        input: { ref: r.text.replace(/\s+/g, ' ').trim() }, meta: { language: c.language, style: c.style, sloppy: c.sloppy, shape: c.shape } });
    }
    return out;
  }
  if (name === 'citetracer') {
    const out = [];
    for (const st of ['R1', 'R2', 'R3', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']) {
      for (const r of JSON.parse(fs.readFileSync(path.join(DATA, 'citetracer', st + '.json'), 'utf8')))
        out.push({ id: r.citation_id, stratum: st, truth: st[0] === 'H' ? 'problem' : 'ok',
          input: { bib: recordToBib(r.citation_id.replace(/[^A-Za-z0-9]/g, ''), r) } });
    }
    return out;
  }
  if (name === 'iclr') {
    const out = [];
    for (const p of JSON.parse(fs.readFileSync(path.join(DATA, 'citetracer', 'iclr2026_hallucinated_refs_structured.json'), 'utf8')))
      for (const h of (p.hallucinated_citations || []))
        if (h.raw_text && h.raw_text.trim()) out.push({ id: `${p.paper_id}:${h.citation_id}`, stratum: 'iclr2026-desk-reject', truth: 'problem',
          input: { ref: h.raw_text.replace(/\s+/g, ' ').trim() } });
    return out;
  }
  throw new Error('unknown dataset ' + name);
}

/* ---------- one item through the site's pipeline ---------- */
function makeContext() {
  const store = {};
  const mk = () => ({ value: '', textContent: '', innerHTML: '', disabled: false, checked: true, style: {}, dataset: {},
    addEventListener() {}, click() {}, scrollIntoView() {}, appendChild() {}, remove() {} });
  const sb = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, URL, URLSearchParams, AbortController, Blob: function () {},
    fetch: (u, init) => fetch(u, Object.assign({}, init || {}, { signal: AbortSignal.timeout(30000) })),
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    document: { readyState: 'complete', addEventListener() {}, getElementById: () => mk(), createElement: () => mk(), body: mk() },
    window: {}, navigator: {}, location: { href: '' },
  };
  vm.createContext(sb);
  vm.runInContext(SRC, sb, { filename: 'bibtex.js+ground.js' });
  return sb;
}
/* flagged = what a user would see as "do not cite as-is / check this":
 * FABRICATED, UNVERIFIED, or a [CHIMERIC…] / [RETRACTED] tag.
 * RATE_LIMITED / errors = inconclusive (not checked), never pass or flag. */
function outcomeOf(base, label) {
  if (!base || base === 'RATE_LIMITED') return 'inconclusive';
  if (base === 'FABRICATED' || base === 'UNVERIFIED' || /\[CHIMERIC|\[RETRACTED\]/.test(label || '')) return 'flagged';
  return 'not_flagged';
}
async function checkItem(it) {
  const sb = makeContext();
  let draft;
  if (it.input.bib) draft = sb.bibToDraft(it.input.bib).draft;
  else draft = `Reference [@ref1].\n\n## References\n\n[@ref1] ${it.input.ref.replace(/^[#\[]+/, '')}\n`;
  if (!draft) return { verdict: 'error: no entry parsed', outcome: 'inconclusive' };
  try {
    const ev = await sb.groundDraft(draft, { bibMode: true }, null);
    if (!ev || ev.length !== 1) return { verdict: `error: ${ev ? ev.length : 0} findings`, outcome: 'inconclusive' };
    const e = ev[0];
    return { verdict: e.label, base: e.base, note: e.note, outcome: outcomeOf(e.base, e.label) };
  } catch (e) {
    return { verdict: 'error: ' + String(e.message || e).slice(0, 200), outcome: 'inconclusive' };
  }
}

const all = loadDataset(dataset);
const items = sampleStrata(all, perArg, SEED);
const name = OUTNAME || `veripaper_web_${dataset}${perArg ? '_per' + perArg : ''}`;
fs.mkdirSync(path.join(HERE, 'results'), { recursive: true });
const jl = path.join(HERE, 'results', name + '.jsonl');
const done = {};
if (fs.existsSync(jl)) for (const l of fs.readFileSync(jl, 'utf8').split('\n')) if (l.trim()) { const r = JSON.parse(l); done[r.id] = r; }
let commit = ''; try { commit = execSync(`git -C "${ROOT}" rev-parse HEAD`).toString().trim(); } catch (e) {}
let dirty = ''; try { dirty = execSync(`git -C "${ROOT}" status --porcelain web/ground.js web/bibtex.js`).toString().trim(); } catch (e) {}
fs.writeFileSync(path.join(HERE, 'results', name + '.meta.json'), JSON.stringify({
  tool: 'veripaper web pipeline (web/bibtex.js + web/ground.js), groundDraft bibMode, no LLM key',
  commit: commit + (dirty ? ' (+ uncommitted changes in web/)' : ''), dataset, population: all.length,
  sample: perArg ? `stratified random, ${perArg} per stratum, mulberry32 seed ${SEED}` : 'all items',
  sampled_ids: items.map(i => i.id), runtime: 'Node ' + process.version + ', fresh vm context + empty cache per item',
  started_at: nowIso() }, null, 2) + '\n');
console.log(`${dataset}: ${items.length} of ${all.length} items (${Object.keys(done).length} already done) -> ${jl}`);

let pending = items.filter(i => !done[i.id] || done[i.id].outcome === 'inconclusive');
for (let rnd = 0; rnd <= RETRY_PAUSES.length && pending.length; rnd++) {
  if (rnd) { console.log(`-- retry round ${rnd}: ${pending.length} inconclusive, pausing ${RETRY_PAUSES[rnd - 1]}s`); await sleep(RETRY_PAUSES[rnd - 1] * 1000); }
  const next = [];
  for (const it of pending) {
    const r = Object.assign({ id: it.id, stratum: it.stratum, truth: it.truth }, await checkItem(it), { checked_at: nowIso() });
    if (it.published) r.published = it.published;
    if (it.meta) r.meta = it.meta;
    const prev = done[it.id];
    r.attempts = ((prev && prev.attempts) || (prev ? [{ verdict: prev.verdict, outcome: prev.outcome, checked_at: prev.checked_at }] : []))
      .concat([{ verdict: r.verdict, outcome: r.outcome, checked_at: r.checked_at }]);
    done[it.id] = r;
    fs.appendFileSync(jl, JSON.stringify(r) + '\n');
    console.log(`${it.id} [${it.stratum}/${it.truth}]: ${r.verdict} -> ${r.outcome}`);
    if (r.outcome === 'inconclusive') next.push(it);
  }
  pending = next;
}
console.log('done', nowIso());
