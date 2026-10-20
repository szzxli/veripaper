#!/usr/bin/env node
/* Retry only the RefExists samples whose outcome was 'inconclusive-error'
 * (a registry was unreachable — by that tool's own honesty model an error
 * is not a verdict). One retry after a pause; every attempt is recorded. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const verifierPath = process.env.REFEXISTS_VERIFIER;
if (!verifierPath) { console.error('Set REFEXISTS_VERIFIER'); process.exit(2); }
const { verifyReference } = await import(pathToFileURL(verifierPath).href);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const doc = JSON.parse(fs.readFileSync(path.join(here, 'samples.json'), 'utf8'));
const byId = Object.fromEntries(doc.samples.map(s => [s.id, s]));
const resPath = path.join(here, 'results_refexists.json');
const resDoc = JSON.parse(fs.readFileSync(resPath, 'utf8'));

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
    default: return 'miss';
  }
}

const targets = resDoc.results.filter(r => r.outcome === 'inconclusive-error');
console.log(`retrying ${targets.length} error samples after 60s pause`);
await sleep(60000);
for (const r of targets) {
  const s = byId[r.id];
  const v = await verifyReference(s.refexists_ref);
  const outcome = score(s, v.status, v.retracted);
  r.attempts = [...(r.attempts || [{ status: r.status, outcome: r.outcome }]),
                { status: v.status, retracted: v.retracted ?? null, outcome }];
  r.first_status = r.attempts[0].status;
  r.status = v.status;
  r.retracted = v.retracted ?? null;
  r.confidence = v.confidence ?? null;
  r.outcome = outcome;
  console.log(`${r.id}: retry -> status=${v.status} retracted=${v.retracted} -> ${outcome}`);
  await sleep(600);
}
fs.writeFileSync(resPath, JSON.stringify(resDoc, null, 2));
const tally = {};
for (const r of resDoc.results) {
  const k = `${r.category} / ${r.outcome}`;
  tally[k] = (tally[k] || 0) + 1;
}
console.log('\nby category/outcome after retry:');
for (const k of Object.keys(tally).sort()) console.log(' ', k, tally[k]);
