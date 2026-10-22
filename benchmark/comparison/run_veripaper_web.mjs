#!/usr/bin/env node
/* Run veripaper's WEB pipeline (web/ground.js — the code the live site runs)
 * over the benchmark, in its default keyless configuration: no LLM key, the
 * in-browser NLI model on (same model + same transformers.js version as the
 * site; Node loads it from npm instead of the CDN — the only difference).
 *
 * ground.js is evaluated in a vm context with Node's fetch and an in-memory
 * localStorage. Each sample gets a FRESH context (empty cache, no cooldown
 * state carried over), i.e. each sample is checked like a first visit —
 * conservative: no help from earlier samples' cache. Retry rounds as in
 * METHOD.md (90 s, 240 s), every attempt kept.
 *
 *   cd benchmark/comparison && npm install
 *   node run_veripaper_web.mjs [result-name] [--src path/to/ground.js] [--no-nli]
 *   e.g. node run_veripaper_web.mjs veripaper_web_before --src /tmp/ground_main.js
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const args = process.argv.slice(2);
const flag = (f) => { const i = args.indexOf(f); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const noNli = args.includes('--no-nli'); if (noNli) args.splice(args.indexOf('--no-nli'), 1);
const srcPath = flag('--src') || path.join(ROOT, 'web', 'ground.js');
const name = args[0] || 'veripaper_web';
const SRC = fs.readFileSync(srcPath, 'utf8');
const RETRY_PAUSES = [90, 240];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, '+00:00');

let T = null;
async function nliLoader() {
  if (!T) T = await import('@huggingface/transformers');
  return T;
}

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
    window: noNli ? {} : { vpNliLoader: nliLoader }, navigator: {}, location: { href: '' },
  };
  vm.createContext(sb);
  vm.runInContext(SRC, sb, { filename: 'ground.js' });
  return sb;
}

/* Same pre-registered rules as comparison/score.py::score_veripaper. */
function score(sample, base, label) {
  const cat = sample.category;
  if (base === 'RATE_LIMITED') return 'inconclusive';
  if (cat === 'real') return ['CITED', 'ABSTRACT-SUPPORTED'].includes(base) ? 'pass' : (['FABRICATED', 'UNVERIFIED'].includes(base) ? 'false-alarm' : 'miss');
  if (cat === 'fabricated') return sample.subtype === 'fabricated-entry-no-id' ? (base === 'UNVERIFIED' ? 'pass' : 'miss') : (base === 'FABRICATED' ? 'pass' : 'miss');
  if (cat === 'chimeric') return label.includes('[CHIMERIC') ? 'pass' : 'miss';
  if (cat === 'retracted') return label.includes('[RETRACTED]') ? 'pass' : 'miss';
  if (cat === 'specific-not-in-abstract') return (label.includes('[SPECIFIC-NOT-IN-ABSTRACT]') || label.includes('[POSSIBLE-MISATTRIBUTION]')) ? 'pass' : 'miss';
  return 'miss';
}

async function checkOne(s) {
  const sb = makeContext();
  let ev;
  try {
    ev = await sb.groundDraft(s.draft, { apiKey: null, keyless: !noNli }, null);
  } catch (e) {
    return { id: s.id, category: s.category, subtype: s.subtype, verdict: 'error: ' + (e.message || e), outcome: 'inconclusive' };
  }
  if (!ev || ev.length !== 1)
    return { id: s.id, category: s.category, subtype: s.subtype, verdict: `error: ${ev ? ev.length : 0} findings`, outcome: 'inconclusive' };
  const e = ev[0];
  return { id: s.id, category: s.category, subtype: s.subtype, verdict: e.label, base_label: e.base,
    note: e.note, outcome: score(s, e.base, e.label) };
}

const samples = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'samples.json'), 'utf8')).samples;
const results = {};
let pending = samples.slice();
for (let rnd = 0; rnd <= RETRY_PAUSES.length && pending.length; rnd++) {
  if (rnd) { console.log(`-- retry round ${rnd}: ${pending.length} inconclusive, pausing ${RETRY_PAUSES[rnd - 1]}s`); await sleep(RETRY_PAUSES[rnd - 1] * 1000); }
  const next = [];
  for (const s of pending) {
    const r = await checkOne(s);
    r.checked_at = nowIso();
    const prev = results[s.id];
    r.attempts = (prev ? prev.attempts : []).concat([Object.assign({}, r)]);
    results[s.id] = r;
    console.log(`${s.id}: ${r.verdict} -> ${r.outcome}`);
    if (r.outcome === 'inconclusive') next.push(s);
  }
  pending = next;
}
const rows = samples.filter((s) => results[s.id]).map((s) => { const r = results[s.id]; if (r.attempts.length === 1) delete r.attempts; return r; });
let commit = '';
try { commit = execSync(`git -C "${ROOT}" rev-parse HEAD`).toString().trim(); } catch (e) {}
let dirty = '';
try { dirty = execSync(`git -C "${ROOT}" status --porcelain web/ground.js`).toString().trim(); } catch (e) {}
const out = path.join(HERE, 'results', name + '.json');
fs.writeFileSync(out, JSON.stringify({
  tool: 'veripaper (web pipeline web/ground.js, no LLM key' + (noNli ? ', keyless model off' : ', keyless in-browser NLI on') + ')',
  source: path.relative(ROOT, srcPath) === 'web/ground.js' ? 'web/ground.js' : srcPath,
  commit: commit + (dirty && srcPath === path.join(ROOT, 'web', 'ground.js') ? ' (+ uncommitted changes in web/ground.js)' : ''),
  nli_model: noNli ? null : 'Xenova/nli-deberta-v3-xsmall (q8) via @huggingface/transformers 4.3.1',
  input: 'samples.json `draft`',
  runtime: 'Node ' + process.version + ', fresh vm context + empty cache per sample',
  run_finished_at: nowIso(),
  results: rows,
}, null, 2) + '\n');
console.log('wrote', out);
