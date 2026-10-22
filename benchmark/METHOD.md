# Benchmark method

A public, reproducible benchmark for citation checking: does a checker
recognise real citations, and does it catch the ways citations go wrong —
fabricated identifiers, fabricated entries, chimeric citations (real title,
wrong authors), retracted works, and claims whose hard specifics are absent
from the cited work's abstract?

**Honesty statement.** This benchmark was constructed by the veripaper
authors (first-party). That is a bias risk, so the construction and scoring
rules below were fixed before any run, ground truth was verified live
against the public registries at build time (never asserted from memory),
and the published results include every miss, false alarm and inconclusive
sample. Sample set, runners and raw outputs are all in this directory —
anyone can re-run and check. Corrections are welcome via issues/PRs.

## Samples (samples.json, n = 34)

| Category | n | Construction |
|---|---|---|
| real | 8 | Identifiers and entry metadata taken from the registry record itself (Crossref / DataCite / arXiv), in mixed formats: DOI in text, arXiv ID in text, reference-list entries with and without identifiers. Kept only if the identifier resolved at build time. |
| fabricated | 8 | Five carry invented identifiers (3 DOI, 2 arXiv) — kept only if the registry lookup at build time *definitively* returned not-found (a 429 would have dropped the sample). Three are invented reference entries (authors, title, venue, year) with no identifier; no checker can prove those fabricated, so the honest positive outcome is "unverifiable / not indexed". |
| chimeric | 6 | A real paper's exact registry title paired with authors disjoint from the registry author list, as reference-list entries; three carry the real identifier, three carry none. Disjointness was construction-checked with veripaper's own `detect_chimeric` against the live author list. |
| retracted | 6 | Works with OpenAlex `is_retracted = true` at build time. Whether Crossref also prefixes the title with a retraction marker is recorded per sample (`crossref_title_prefix_signal`), because that prefix is the only retraction signal veripaper's Crossref lookup reads — the two formats in the wild are `RETRACTED: …` and `RETRACTED ARTICLE: …`. |
| specific-not-in-abstract | 6 | A real paper cited by a claim whose hard specifics (percentages) are absent from the paper's abstract, verified at build time with veripaper's own `specifics_missing_from_abstract` against the abstract fetched from the same public sources the checker queries. Includes one misattribution-shaped case (spec-04: a successor method's number cited to its predecessor). |

`build_samples.py` performs all build-time verification and drops any
candidate that fails it. Registry contents drift; re-run it before quoting
results from an old copy of this set.

## Tools run

- **veripaper** — the Python pipeline in this repository (`veripaper/`
  package), run exactly as shipped, in its **default no-key
  configuration** (no `VERIPAPER_API_KEY`): the configuration a user
  without an LLM key gets. Drafts are the samples' `draft` fields, fed to
  `pipeline.run_ground`; labels are parsed from the pipeline's own report.
  Note: veripaper's claim-support backstop (the
  `[SPECIFIC-NOT-IN-ABSTRACT]` / `[POSSIBLE-MISATTRIBUTION]` tags) only
  engages after a BYOK LLM judge returns SUPPORTED, so in this
  configuration that layer is expected to stay silent — the run measures
  the default product, not the BYOK upgrade.
- **RefExists** — [DSL4-Digital/RefExists](https://github.com/DSL4-Digital/RefExists)
  (MIT), commit `5fa3ffbaf3bc2f40877a5d3e2e446615455a5a62`, run unmodified
  via its own `public/verifier.js` (`verifyReference`). RefExists checks
  reference entries, not claims, so it was fed each sample's
  bibliography-form string (`refexists_ref` in samples.json) — its native
  input contract. Claim-support checking is out of scope for it by design;
  for the specific-not-in-abstract samples only the underlying reference
  verdict is recorded.

## Scoring rules (fixed before the runs)

veripaper:
- real — pass: base label `CITED` or `ABSTRACT-SUPPORTED`;
  `FABRICATED`/`UNVERIFIED` on a real sample = false alarm.
- fabricated with identifier — pass: `FABRICATED`. Fabricated entry without
  identifier — pass: `UNVERIFIED` (flagged as unverifiable).
- chimeric — pass: label carries `[CHIMERIC:author-mismatch]`.
- retracted — pass: label carries `[RETRACTED]`.
- specific-not-in-abstract — pass: label carries
  `[SPECIFIC-NOT-IN-ABSTRACT]` or `[POSSIBLE-MISATTRIBUTION]`.
- Any sample whose base label is `RATE_LIMITED` is **inconclusive**, never
  a miss: rate-limiting is not a verdict.

RefExists:
- real — pass: `verified` or `likely`; `partial` recorded separately.
- fabricated with identifier — pass: `not_found`. Without identifier —
  pass: `no_match`.
- chimeric — pass: flagged, i.e. `mismatch` or `partial` (not clean).
- retracted — pass: its `retracted` flag is true (checked via OpenAlex).
- specific-not-in-abstract — out of scope (see above).
- `error` (a registry unreachable) is **inconclusive**, never a verdict.

## Retries

Rate-limited / error samples were retried after pauses (veripaper: two
retry rounds, after 90 s and 240 s; RefExists: one round after 60 s) — the
tools' own labels define these states as "not checked, try again later",
so a documented retry is the intended remedy, not score-shopping. Every
attempt is preserved in the results JSON files (`attempts`, `first_label` /
`first_status`). Samples still limited after the final round are reported
as inconclusive.

## Reproduce

```bash
python3 benchmark/build_samples.py        # re-verify ground truth, rebuild samples.json
python3 benchmark/run_veripaper.py        # score veripaper (no-key default)
git clone https://github.com/DSL4-Digital/RefExists
REFEXISTS_VERIFIER=$PWD/RefExists/public/verifier.js \
REFEXISTS_COMMIT=$(git -C RefExists rev-parse HEAD) \
  node benchmark/run_refexists.mjs        # score RefExists
```

Raw per-sample outputs: `results_veripaper.json`, `results_refexists.json`.
Summary and reading of the numbers: `COMPARISON.md` (latest runs, including
the web app's keyless configuration via `comparison/run_veripaper_web.mjs`).

## Limitations

- Small n per category (5–8): this is a smoke benchmark, not a statistical
  evaluation. Treat category scores as signals, not rates.
- First-party construction: mitigations are pre-registered rules, live
  ground-truth verification, and publishing all outcomes — but independent
  replication is still worth more than this document.
- Both tools depend on public registry rate budgets. Runs from a shared
  egress IP left several no-identifier samples inconclusive for veripaper
  (Semantic Scholar's unauthenticated search quota) despite retries.
- Ground truth is a snapshot (2026-10-20). Registries add, correct and
  retract records; a sample's truth can change after the run.
