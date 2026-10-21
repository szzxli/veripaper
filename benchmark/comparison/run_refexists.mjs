#!/usr/bin/env node
/* Run RefExists (github.com/DSL4-Digital/RefExists, MIT), unmodified, via its
 * own public/verifier.js `verifyReference`, on each sample's `refexists_ref`
 * string (its native input contract). Same scoring as METHOD.md (score.py
 * score_refexists, mirrored below). Inconclusive (`error`) samples are retried
 * after 90 s and 240 s; every attempt is kept.
 *
 *   git clone https://github.com/DSL4-Digital/RefExists
 *   REFEXISTS_VERIFIER=$PWD/RefExists/public/verifier.js \
 *   REFEXISTS_COMMIT=$(git -C RefExists rev-parse HEAD) node run_refexists.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const vp = process.env.REFEXISTS_VERIFIER;
if (!vp) { console.error('Set REFEXISTS_VERIFIER'); process.exit(2); }
const { verifyReference } = await import(pathToFileURL(vp).href);
const samples = JSON.parse(fs.readFileSync(path.join(here, '..', 'samples.json'), 'utf8')).samples;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

function score(s, status, retracted) {
  if (status === 'error') return 'inconclusive';
  switch (s.category) {
    case 'real': return (status === 'verified' || status === 'likely') ? 'pass'
      : status === 'partial' ? 'metadata-flag' : 'false-alarm';
    case 'fabricated':
      if (s.subtype === 'fabricated-entry-no-id') return status === 'no_match' ? 'pass' : 'miss';
      return status === 'not_found' ? 'pass' : 'miss';
    case 'chimeric': return (status === 'mismatch' || status === 'partial') ? 'pass' : 'miss';
    case 'retracted': return retracted === true ? 'pass' : 'miss';
    default: return 'out-of-scope';
  }
}

async function checkOne(s) {
  try {
    const r = await verifyReference(s.refexists_ref);
    const verdict = r.status + (r.retracted ? ' + retracted' : '');
    return { id: s.id, category: s.category, subtype: s.subtype, verdict,
      status: r.status, retracted: r.retracted ?? null, confidence: r.confidence ?? null,
      outcome: score(s, r.status, r.retracted), checked_at: now() };
  } catch (e) {
    return { id: s.id, category: s.category, subtype: s.subtype, verdict: 'exception',
      error: String(e && e.message || e), outcome: 'inconclusive', checked_at: now() };
  }
}

const results = {};
let pending = samples;
for (const pause of [0, 90, 240]) {
  if (!pending.length) break;
  if (pause) { console.log(`-- retry: ${pending.length} inconclusive, pausing ${pause}s`); await sleep(pause * 1000); }
  const next = [];
  for (const s of pending) {
    const r = await checkOne(s);
    const prev = results[s.id];
    r.attempts = (prev ? prev.attempts : []).concat([{ ...r }]);
    results[s.id] = r;
    console.log(`${s.id}: ${r.verdict} -> ${r.outcome}`);
    if (r.outcome === 'inconclusive') next.push(s);
    await sleep(600);
  }
  pending = next;
}
const rows = samples.map(s => results[s.id]);
for (const r of rows) if (r.attempts.length === 1) delete r.attempts;
fs.mkdirSync(path.join(here, 'results'), { recursive: true });
fs.writeFileSync(path.join(here, 'results', 'refexists.json'), JSON.stringify({
  tool: 'RefExists (DSL4-Digital/RefExists)', commit: process.env.REFEXISTS_COMMIT || 'unknown',
  input: 'samples.json `refexists_ref`', node: process.version,
  run_finished_at: now(), results: rows }, null, 2) + '\n');
console.log('wrote results/refexists.json');
