#!/usr/bin/env node
/* Run RefExists (github.com/DSL4-Digital/RefExists, MIT) over the same
 * benchmark samples and score it with pre-registered rules (METHOD.md).
 *
 * RefExists checks reference entries, not claims, so each sample is fed
 * its bibliography-form reference string (samples.json: refexists_ref).
 * Claim-support categories are out of scope for this tool by design —
 * for those samples only the underlying reference verdict is recorded.
 *
 * Usage:
 *   REFEXISTS_VERIFIER=/path/to/RefExists/public/verifier.js \
 *     node run_refexists.mjs
 * Record the RefExists commit you ran against (REFEXISTS_COMMIT env or
 * the runner reads it from a sibling .git if present).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const verifierPath = process.env.REFEXISTS_VERIFIER;
if (!verifierPath) {
  console.error('Set REFEXISTS_VERIFIER to the public/verifier.js of a RefExists clone.');
  process.exit(2);
}
const { verifyReference } = await import(pathToFileURL(verifierPath).href);
const commit = process.env.REFEXISTS_COMMIT || 'unknown';

const doc = JSON.parse(fs.readFileSync(path.join(here, 'samples.json'), 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

function score(sample, status, retracted) {
  switch (sample.category) {
    case 'real':
      if (status === 'verified' || status === 'likely') return 'pass';
      if (status === 'partial') return 'partial-flag';
      if (status === 'error') return 'inconclusive-error';
      return 'miss';
    case 'fabricated':
      if (sample.subtype === 'fabricated-entry-no-id') {
        if (status === 'no_match') return 'pass';
        if (status === 'error') return 'inconclusive-error';
        return 'miss';
      }
      if (status === 'not_found') return 'pass';
      if (status === 'error') return 'inconclusive-error';
      return 'miss';
    case 'chimeric':
      if (status === 'mismatch' || status === 'partial') return 'pass';
      if (status === 'error') return 'inconclusive-error';
      return 'miss';
    case 'retracted':
      if (retracted === true) return 'pass';
      if (status === 'error') return 'inconclusive-error';
      return 'miss';
    case 'specific-not-in-abstract':
      return 'out-of-scope-claim-support';
    default:
      return 'miss';
  }
}

const results = [];
for (const s of doc.samples) {
  let r;
  try {
    r = await verifyReference(s.refexists_ref);
  } catch (e) {
    results.push({ id: s.id, category: s.category, subtype: s.subtype,
                   error: String(e && e.message || e), outcome: 'inconclusive-error' });
    console.log(`${s.id}: EXCEPTION ${e && e.message || e}`);
    continue;
  }
  const outcome = score(s, r.status, r.retracted);
  results.push({ id: s.id, category: s.category, subtype: s.subtype,
                 status: r.status, retracted: r.retracted ?? null,
                 confidence: r.confidence ?? null, outcome });
  console.log(`${s.id}: status=${r.status} retracted=${r.retracted} -> ${outcome}`);
  await sleep(600);
}

fs.writeFileSync(path.join(here, 'results_refexists.json'), JSON.stringify({
  tool: 'RefExists (DSL4-Digital/RefExists)',
  commit, run_at: '2026-10-20', results,
}, null, 2));
const tally = {};
for (const r of results) {
  const k = `${r.category} / ${r.outcome}`;
  tally[k] = (tally[k] || 0) + 1;
}
console.log('\nby category/outcome:');
for (const k of Object.keys(tally).sort()) console.log(' ', k, tally[k]);
