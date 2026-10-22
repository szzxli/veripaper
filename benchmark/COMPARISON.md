# Comparative benchmark: veripaper vs. open-source citation checkers

Run date: **2026-10-21** (UTC timestamps per run below). Same 34 labelled
samples as `METHOD.md` / `samples.json` (real 8, fabricated 8, chimeric 6,
retracted 6, specific-not-in-abstract 6), run through every open-source
checker we could run legitimately and for free, plus veripaper itself.

**Honesty statement.** First-party: built and run by the veripaper authors.
Mitigations: scoring rules mapped from the ones `METHOD.md` fixed on
2026-10-20; every tool run unmodified through its own documented interface;
every verdict below is generated from the raw result files by
`comparison/make_table.py` (no number typed by hand); every miss, false
alarm and inconclusive sample — veripaper's included — is shown. Raw
outputs, inputs, runners and tool versions are all in this directory.
Please re-run it and file corrections.

## Latest: free fallbacks + keyless claim check (web app), before / after

The web app (`web/ground.js`, what the live site runs) was re-run on all 34
samples before and after the change that added free lookup fallbacks
(DataCite/arXiv, OpenAlex, Semantic Scholar moved to last), a request queue
with backoff/cooldown and a local cache, and the **keyless claim check**
(deterministic specifics check + a small NLI model running in the browser).
Both runs: no LLM key, default settings, Node 20 via
`comparison/run_veripaper_web.mjs`, fresh cache per sample, same retry
policy (90 s, 240 s). Numbers copied from the generated table below.

| Category (n) | Python CLI, no key (previous published run) | web, before (main @ `b4bb41a`) | web, after (this change) |
|---|---|---|---|
| real (8) | 7/8 · 1 inconclusive | 7/8 · **1 false alarm** (real-05) | **8/8** |
| fabricated (8) | 6/8 · 2 inconclusive | 7/8 · 1 inconclusive | **8/8** |
| chimeric (6) | 3/6 · 3 inconclusive | 3/6 · 1 miss, 2 inconclusive | **6/6** |
| retracted (6) | 6/6 | 6/6 | 6/6 |
| specific-not-in-abstract (6) | 0/6 (6 miss) | 0/6 (6 miss) | **6/6** |
| inconclusive (`RATE_LIMITED`) after retries | 5 | 3 | **0** |

What changed the numbers, and what did not:

- **Entries without an identifier** (real-05, fab-06/07/08, chim-01/05/06)
  no longer depend on Semantic Scholar. real-05, chim-01 and chim-05 now
  resolve through DataCite's records of the arXiv versions (title-in-entry
  + year gate, unchanged); chim-06 likewise. The fabricated entries get two
  or more clean "no match" answers (Crossref, DataCite, and OpenAlex when
  its budget allowed) and are labelled `UNVERIFIED`, with the rate-limited
  sources named in the note — instead of `RATE_LIMITED`. Semantic Scholar
  still answered HTTP 429 to every request from this network.
- **Specific-not-in-abstract 6/6 comes from the deterministic check, not
  from the model.** The keyless mode now runs the specifics check
  (numbers / percentages / acronyms must appear in the abstract) without
  needing an LLM to say SUPPORTED first. Caveat, stated plainly: these six
  samples were *constructed* with that same check
  (`specifics_missing_from_abstract`, see `METHOD.md`), so this row
  confirms the check now runs in the default configuration — it is not
  independent evidence of claim-checking accuracy.
- **The NLI model is not what this benchmark measures.** No category tests
  "a correct claim that the abstract supports". In the scored run the
  keyless model upgraded none of the eight real samples to
  `ABSTRACT-SUPPORTED [KEYLESS-NLI]`: three had high entailment but also a
  strongly "contradicting" passage (shown as "mixed signal"), the rest low
  entailment, real-06 has no retrievable abstract. Development runs of
  earlier versions upgraded one to three of them; real-01's entailment
  moved from 91% to 1% between runs because a different source supplied
  its abstract text — the keyless verdict depends on which abstract
  arrives. It never raised a false alarm, because the model can only
  upgrade `CITED` → `ABSTRACT-SUPPORTED` and never touches existence
  verdicts. Retracted and chimeric citations are never labelled supported.
- **Retracted** was already 6/6 after the earlier retraction fix.
- Source availability shaped this run too: OpenAlex's keyless search
  budget is shared per IP and was exhausted for part of the run (the
  per-host cooldown skipped it instead of waiting 30 minutes); Semantic
  Scholar was rate-limited throughout; DBLP served a bot-check page
  (treated as "unavailable", not as "no match").

## Tools tested

| Tool | Licence | Version / commit | How it was run | Input it got |
|---|---|---|---|---|
| **veripaper** (this repo), Python CLI | MIT | Python pipeline, see provenance below | `comparison/run_veripaper.py`: `pipeline.run_ground`, default **no-key** configuration | `draft` (claim + citation, as a user pastes it) |
| **veripaper** (this repo), web app | MIT | `web/ground.js`, before (main `b4bb41a`) and after this change | `comparison/run_veripaper_web.mjs`: `groundDraft` in a Node vm context, no LLM key, keyless NLI model on (after) | `draft` |
| [RefExists](https://github.com/DSL4-Digital/RefExists) | MIT | commit `5fa3ffb` (latest on 2026-10-21) | unmodified `public/verifier.js` `verifyReference()` in Node 20 | `refexists_ref` (one reference string) |
| [citegate](https://github.com/chrisyangsong/citegate) | MIT | 0.3.0, commit `94cc0a0` | its CLI, `citegate <entry>.bib --json`, defaults, no `--mailto` | `samples.bib` entry (one per run) |
| [refchecker](https://github.com/markrussinovich/refchecker) (academic-refchecker) | MIT | 3.1.7, commit `66d0cb5` | `refchecker-webui check --paper samples.bib --no-llm --check-retractions --json` — its documented keyless path | `samples.bib` |

citegate and refchecker take BibTeX natively, so `samples.bib` is a
transcription of each sample's `refexists_ref` string into one BibTeX
entry (rules in the file's header: fields copied, nothing added, `et al.`
→ `and others`). That is a translation step and could favour or hurt a
tool; it is published so it can be checked.

Neither citegate nor refchecker (nor RefExists) claims to check whether a
cited work supports a claim, so `specific-not-in-abstract` is out of scope
for them, by their own design — not a miss.

## Not tested, and why

| Tool | Status | Reason |
|---|---|---|
| refchecker's LLM "hallucination deep search" | not exercised | needs a paid LLM provider key (OpenAI / Anthropic / Google / Azure); only its deterministic no-LLM path is scored above |
| veripaper BYOK LLM judge (claim support) | not exercised | needs the user's own paid LLM key. Since the keyless change the web app's default configuration covers `[SPECIFIC-NOT-IN-ABSTRACT]` without a key (6/6 above); the Python CLI still needs the key for that row (0/6) |
| [ValiRef](https://github.com/Gianthard-cyh/ValiRef) | not run | open source (MIT) but its verification is DeepSeek-LLM-driven and needs a paid API key |
| [hallucinator](https://github.com/gianlucasb/hallucinator) | not run (this round) | open source (AGPL-3.0), runnable in principle, but its input is PDF papers (the samples would have to be typeset into PDFs, a different input contract); its online DBLP backend is documented as broken (Anubis bot-protection) and its online OpenAlex backend expects an API key from an account signup. Candidate for a future round with an offline DBLP DB |
| [k-zhai/bibtex-verifier](https://github.com/k-zhai/bibtex-verifier) and other small repos found by search | not run | no licence file (use rights unclear) or not yet evaluated; suggestions welcome |
| Citely, Scite Reference Check, Recite, GPTZero Hallucination Check, Sourcely, RefCheck, TrueCite / WisPaper, Paperpal, Clarity | **not tested** | closed commercial web apps. We do not script or scrape them, and every free tier needs an account, which this run did not create. Free tiers and what their terms say about manual testing / publishing results: see [Commercial tools](#commercial-tools-not-tested-free-tiers-and-terms). 0 of 34 run |

## Scoring

Shared outcome vocabulary (`comparison/score.py`):

- **pass** — caught what the category asks (on `real`: recognised as
  existing, nothing flagged)
- **miss** — did not
- **false alarm** — a real citation reported as non-existent / unverifiable
- **metadata flag** — a real citation found, but a metadata problem
  flagged (e.g. "year mismatch"); counted separately because the work is
  recognised, but it is still a warning a user has to clear
- **inconclusive** — the tool's own "not checked" state (veripaper
  `RATE_LIMITED`; RefExists `error`; refchecker `Verification timed out`;
  citegate `error`). Never counted as pass or miss
- **out of scope** — category outside the tool's stated scope

Per-category mapping, the principle `METHOD.md` fixed for RefExists
applied to each tool's own verdicts:

| Category | veripaper | RefExists | citegate | refchecker |
|---|---|---|---|---|
| real | `CITED` / `ABSTRACT-SUPPORTED` | `verified` / `likely` (`partial` = metadata flag) | `verified` (`mismatch` = metadata flag) | `verified` / `suggestion` (`warning` / `error` = metadata flag) |
| fabricated, with identifier | `FABRICATED` | `not_found` | `not-found` | `unverified` |
| fabricated, no identifier | `UNVERIFIED` | `no_match` | `not-found` / `unverifiable` | `unverified` |
| chimeric | `[CHIMERIC:author-mismatch]` | `mismatch` / `partial` | `mismatch` | `error` / `warning` |
| retracted | `[RETRACTED]` | `retracted` flag | `retracted` | `--check-retractions` status `retracted` (`unknown` = inconclusive) |
| specific-not-in-abstract | `[SPECIFIC-NOT-IN-ABSTRACT]` / `[POSSIBLE-MISATTRIBUTION]` | out of scope | out of scope | out of scope |

On fabricated entries, a verdict that says a real work exists (RefExists
`partial`, citegate `mismatch`) is a miss even though it asks for review —
the same rule METHOD.md used on 2026-10-20.

Retries: inconclusive samples are re-run after 90 s and 240 s (same policy
as `METHOD.md`); all attempts are kept in the result files.

## Results

<!-- GENERATED:BEGIN -->
| Category (n) | veripaper Python CLI, no key (+ retraction fix) | veripaper web, no key (before: main @ b4bb41a) | veripaper web, no key (after: fallbacks + keyless NLI) | RefExists | citegate | refchecker (no-LLM) |
|---|---|---|---|---|---|---|
| real (8) | 7/8 recognised · 1 inconclusive | 7/8 recognised · **1 false alarm** | 8/8 recognised | 8/8 recognised | 5/8 recognised · 3 metadata flag | 7/8 recognised · 1 metadata flag |
| fabricated (8) | 6/8 (2 inconclusive) | 7/8 (1 inconclusive) | 8/8 | 5/8 (3 miss) | 7/8 (1 miss) | 6/8 (2 inconclusive) |
| chimeric (6) | 3/6 (3 inconclusive) | 3/6 (1 miss, 2 inconclusive) | 6/6 | 3/6 (3 miss) | 4/6 (2 miss) | 6/6 |
| retracted (6) | 6/6 | 6/6 | 6/6 | 6/6 | 6/6 | 6/6 |
| specific-not-in-abstract (6) | 0/6 (6 miss) | 0/6 (6 miss) | 6/6 | out of scope | out of scope | out of scope |

Per-sample outcomes (verdict → outcome):

| Sample | veripaper Python CLI, no key (+ retraction fix) | veripaper web, no key (before: main @ b4bb41a) | veripaper web, no key (after: fallbacks + keyless NLI) | RefExists | citegate | refchecker (no-LLM) |
|---|---|---|---|---|---|---|
| real-01 | CITED [STALE:2016] → pass | CITED [STALE:2016] → pass | CITED [STALE:2016] → pass | verified → pass | verified → pass | verified (retraction: clean) → pass |
| real-02 | CITED → pass | CITED → pass | CITED → pass | verified → pass | mismatch → metadata-flag | verified (retraction: no_doi) → pass |
| real-03 | CITED → pass | CITED → pass | CITED → pass | verified → pass | verified → pass | verified (retraction: no_doi) → pass |
| real-04 | CITED → pass | CITED → pass | CITED → pass | verified → pass | verified → pass | verified (retraction: clean) → pass |
| real-05 | RATE_LIMITED → inconclusive | UNVERIFIED → false-alarm | CITED → pass | likely → pass | mismatch → metadata-flag | suggestion (retraction: no_doi) → pass |
| real-06 | CITED → pass | CITED → pass | CITED → pass | verified → pass | verified → pass | verified (retraction: clean) → pass |
| real-07 | CITED → pass | CITED → pass | CITED → pass | verified → pass | mismatch → metadata-flag | warning (retraction: no_doi) → metadata-flag |
| real-08 | CITED → pass | CITED → pass | CITED → pass | verified → pass | verified → pass | verified (retraction: no_doi) → pass |
| fab-01 | FABRICATED → pass | FABRICATED → pass | FABRICATED → pass | not_found → pass | not-found → pass | unverified (retraction: unknown) → pass |
| fab-02 | FABRICATED → pass | FABRICATED → pass | FABRICATED → pass | not_found → pass | not-found → pass | unverified (retraction: unknown) → pass |
| fab-03 | FABRICATED → pass | FABRICATED → pass | FABRICATED → pass | not_found → pass | not-found → pass | unverified (retraction: no_doi) → inconclusive |
| fab-04 | FABRICATED → pass | FABRICATED → pass | FABRICATED → pass | partial → miss | not-found → pass | unverified (retraction: unknown) → pass |
| fab-05 | FABRICATED → pass | FABRICATED → pass | FABRICATED → pass | not_found → pass | not-found → pass | unverified (retraction: no_doi) → inconclusive |
| fab-06 | UNVERIFIED → pass | UNVERIFIED → pass | UNVERIFIED → pass | partial → miss | not-found → pass | unverified (retraction: no_doi) → pass |
| fab-07 | RATE_LIMITED → inconclusive | UNVERIFIED → pass | UNVERIFIED → pass | no_match → pass | mismatch → miss | unverified (retraction: no_doi) → pass |
| fab-08 | RATE_LIMITED → inconclusive | RATE_LIMITED → inconclusive | UNVERIFIED → pass | partial → miss | not-found → pass | unverified (retraction: no_doi) → pass |
| chim-01 | RATE_LIMITED → inconclusive | RATE_LIMITED → inconclusive | CITED [CHIMERIC:author-mismatch] → pass | partial → pass | mismatch → pass | error (retraction: no_doi) → pass |
| chim-02 | CITED [CHIMERIC:author-mismatch] → pass | CITED [CHIMERIC:author-mismatch] → pass | CITED [CHIMERIC:author-mismatch] → pass | partial → pass | mismatch → pass | error (retraction: clean) → pass |
| chim-03 | CITED [CHIMERIC:author-mismatch] → pass | CITED [CHIMERIC:author-mismatch] → pass | CITED [CHIMERIC:author-mismatch] → pass | verified → miss | not-found → miss | error (retraction: no_doi) → pass |
| chim-04 | CITED [CHIMERIC:author-mismatch] → pass | CITED [CHIMERIC:author-mismatch] → pass | CITED [CHIMERIC:author-mismatch] → pass | verified → miss | mismatch → pass | error (retraction: clean) → pass |
| chim-05 | RATE_LIMITED → inconclusive | UNVERIFIED → miss | CITED [CHIMERIC:author-mismatch] → pass | partial → pass | mismatch → pass | error (retraction: no_doi) → pass |
| chim-06 | RATE_LIMITED → inconclusive | RATE_LIMITED → inconclusive | CITED [CHIMERIC:author-mismatch] → pass | no_match → miss | not-found → miss | error (retraction: no_doi) → pass |
| retr-01 | CITED [RETRACTED] → pass | CITED [RETRACTED] → pass | CITED [RETRACTED] → pass | verified + retracted → pass | retracted → pass | verified (retraction: retracted) → pass |
| retr-02 | CITED [RETRACTED] → pass | CITED [RETRACTED] → pass | CITED [RETRACTED] → pass | verified + retracted → pass | retracted → pass | verified (retraction: retracted) → pass |
| retr-03 | CITED [RETRACTED] → pass | CITED [RETRACTED] → pass | CITED [RETRACTED] → pass | verified + retracted → pass | retracted → pass | verified (retraction: retracted) → pass |
| retr-04 | CITED [RETRACTED] → pass | CITED [RETRACTED] → pass | CITED [RETRACTED] → pass | verified + retracted → pass | retracted → pass | verified (retraction: retracted) → pass |
| retr-05 | CITED [RETRACTED] → pass | CITED [RETRACTED] → pass | CITED [RETRACTED] → pass | verified + retracted → pass | retracted → pass | verified (retraction: retracted) → pass |
| retr-06 | CITED [RETRACTED] → pass | CITED [RETRACTED] → pass | CITED [RETRACTED] → pass | verified + retracted → pass | retracted → pass | verified (retraction: retracted) → pass |
| spec-01 | CITED → miss | CITED → miss | CITED [SPECIFIC-NOT-IN-ABSTRACT] → pass | verified → out-of-scope | verified → out-of-scope | verified (retraction: no_doi) → out-of-scope |
| spec-02 | CITED [STALE:2016] → miss | CITED [STALE:2016] → miss | CITED [STALE:2016] [SPECIFIC-NOT-IN-ABSTRACT] → pass | verified → out-of-scope | verified → out-of-scope | verified (retraction: clean) → out-of-scope |
| spec-03 | CITED → miss | CITED → miss | CITED [SPECIFIC-NOT-IN-ABSTRACT] → pass | verified → out-of-scope | mismatch → out-of-scope | verified (retraction: no_doi) → out-of-scope |
| spec-04 | CITED [STALE:2006] → miss | CITED [STALE:2006] → miss | CITED [STALE:2006] [SPECIFIC-NOT-IN-ABSTRACT] → pass | verified → out-of-scope | verified → out-of-scope | verified (retraction: no_doi) → out-of-scope |
| spec-05 | CITED → miss | CITED → miss | CITED [SPECIFIC-NOT-IN-ABSTRACT] → pass | verified → out-of-scope | not-found → out-of-scope | warning (retraction: no_doi) → out-of-scope |
| spec-06 | CITED → miss | CITED → miss | CITED [SPECIFIC-NOT-IN-ABSTRACT] → pass | verified → out-of-scope | mismatch → out-of-scope | error (retraction: no_doi) → out-of-scope |

Run provenance:

- **veripaper Python CLI, no key (+ retraction fix)** — tool: `veripaper (python pipeline, no-key default)`; commit: `2e4432047fe245a91e8f50539a4cb4c1633f4f81`; input: `samples.json `draft``; run_finished_at: `2026-10-21T23:14:30+00:00`
- **veripaper web, no key (before: main @ b4bb41a)** — tool: `veripaper (web pipeline web/ground.js, no LLM key; this version has no keyless model)`; source: `web/ground.js @ main b4bb41a (git show main:web/ground.js), unmodified`; commit: `b4bb41a (main, before this change)`; nli_model: `None`; input: `samples.json `draft``; runtime: `Node v20.19.2, fresh vm context + empty cache per sample`; run_finished_at: `2026-10-21T23:51:26+00:00`
- **veripaper web, no key (after: fallbacks + keyless NLI)** — tool: `veripaper (web pipeline web/ground.js, no LLM key, keyless in-browser NLI on)`; source: `web/ground.js`; commit: `b4bb41ae8d2d670906e0b26624d2280558d8c581 (+ uncommitted changes in web/ground.js)`; nli_model: `Xenova/nli-deberta-v3-xsmall (q8) via @huggingface/transformers 4.3.1`; input: `samples.json `draft``; runtime: `Node v20.19.2, fresh vm context + empty cache per sample`; run_finished_at: `2026-10-22T00:11:49+00:00`
- **RefExists** — tool: `RefExists (DSL4-Digital/RefExists)`; commit: `5fa3ffbaf3bc2f40877a5d3e2e446615455a5a62`; input: `samples.json `refexists_ref``; node: `v20.19.2`; run_finished_at: `2026-10-21T22:45:19Z`
- **citegate** — tool: `citegate`; version: `citegate 0.3.0`; commit: `94cc0a02a63a11154664c88b25923cbd0dc7c028`; input: `samples.bib (one entry per run)`; config: `defaults; --workers 1; no --mailto`; run_finished_at: `2026-10-21T22:29:10+00:00`
- **refchecker (no-LLM)** — tool: `refchecker (academic-refchecker)`; version: `3.1.7`; commit: `66d0cb59945474a1c9bd59df6e5b40c9d0c197d3`; input: `samples.bib`; config: `refchecker-webui check --no-llm --check-retractions --json --paper <bib>  (no LLM, no S2 key)`; run_finished_at: `2026-10-21T22:52:07+00:00`
<!-- GENERATED:END -->

## Reading the numbers

**veripaper's misses and gaps — Python CLI, default no-key configuration,
as published before the web-app change (the web app's before/after is at
the top of this file). Earlier columns "before fix" / "+ retraction fix"
refer to commit `2e44320` (see the before/after section):**

- **Retracted: 3/6 before the fix, 6/6 after.** It only read Crossref's `RETRACTED:` title prefix;
  retr-04/05/06 are Springer Nature records titled `RETRACTED ARTICLE: …`.
  All three other tools caught 6/6 (OpenAlex `is_retracted`, and for
  citegate also Crossref/Retraction Watch update records). See the fix
  section.
- **Entries without an identifier are its weak spot.** Six samples (real-05,
  fab-06/07/08, chim-01, chim-06) stayed `RATE_LIMITED` through three
  attempts: after Crossref finds no confident match, veripaper falls back to
  Semantic Scholar's unauthenticated search, whose quota was exhausted from
  our (shared) network. That is honest labelling — not a false verdict — but
  for a user it is still "not checked". chim-05 resolved on retry to
  `UNVERIFIED` (no confident bibliographic match) — a miss.
- **Specific-not-in-abstract: 0/6**, as expected: the specificity
  backstop only runs after a BYOK LLM judge, which this configuration does
  not have.
- On the other side: no false alarm on real citations in this run, and
  every fabricated identifier (5/5) came back `FABRICATED`.

**Other tools, as observed:**

- **RefExists** recognised all 8 real citations and caught all 6
  retractions; on fabricated entries it tends to report `partial` (a
  topically similar real work, flagged for human review), which this
  scoring counts as a miss (fab-04, fab-06, fab-08); with a real identifier
  and a matching title it corroborated chim-03/chim-04 as `verified`
  despite the wrong authors, and found no match for chim-06 (`no_match`).
- **citegate** caught 7/8 fabricated entries and 6/6 retractions. Its 3
  metadata flags on real citations come from matching a different index
  record (real-02 / real-05 matched a record dated 2025; real-07 matched
  "QA-LoRA"). 10 of its 34 verdicts were produced while one of its search
  sources was unavailable from our network (DBLP search on nine, OpenAlex
  search on five) — including both chimeric misses (chim-03, chim-06:
  `not-found`). An unscored trial run of the full file earlier the same day
  (`results/trials/`) returned `mismatch` (a pass) for both, so treat those
  two as source-availability-sensitive, not as a settled weakness.
- **refchecker** (no LLM) flagged all 6 chimeric entries (author mismatch)
  and all 6 retractions, and reported every fabricated entry it finished
  as `unverified`; fab-03 and fab-05 (invented arXiv IDs) timed out on all
  three attempts. One metadata flag on a real citation (real-07, LoRA:
  BibTeX says 2022, index says 2021).

## Retraction fix: before / after

Separate commit `2e44320` ("Retraction detection: read CrossRef
'updated-by' …"). Both signals come from the CrossRef record veripaper
already fetches — no extra request:

1. the title-prefix pattern now also accepts `RETRACTED ARTICLE:`
   (Springer Nature's format), alongside `RETRACTED:` / `WITHDRAWN:`;
2. the record's `updated-by` notices of type `retraction` / `withdrawal` /
   `removal` — CrossRef attaches these from publishers and from the
   Retraction Watch database it hosts. Corrections and expressions of
   concern alone do not flag.

Same samples, same runner, re-run after the commit (`veripaper_after.json`):

| Category | before (pipeline @ `605b409`) | after (pipeline @ `2e44320`) |
|---|---|---|
| retracted (6) | 3/6 (3 miss: retr-04/05/06) | **6/6** |
| real (8) | 7/8, 1 inconclusive | 7/8, 1 inconclusive — no new false alarm |
| `[RETRACTED]` on a non-retracted sample | 0 | 0 |

Only three verdicts changed because of the fix (retr-04/05/06 `CITED` →
`CITED [RETRACTED]`). Two others changed between the runs for an unrelated
reason — Semantic Scholar rate limiting on entries without an identifier:
fab-06 `RATE_LIMITED` → `UNVERIFIED` (now a pass) and chim-05 `UNVERIFIED`
→ `RATE_LIMITED` (miss → inconclusive). The fix does not touch that code
path; this is the run-to-run noise described under Limitations. The web app
got the same change (`ground.js`); a headless-Chromium run against the live
registries flagged all four retracted DOIs `[RETRACTED]` after the change
vs. one of four before.

## Reproduce

```bash
pip install -e .                                    # veripaper (this repo)
python3 benchmark/comparison/run_veripaper.py veripaper_after   # or _before on 605b409

# web app (web/ground.js) incl. the keyless in-browser model
(cd benchmark/comparison && npm install)            # @huggingface/transformers 4.3.1
node benchmark/comparison/run_veripaper_web.mjs veripaper_web_after
git show b4bb41a:web/ground.js > /tmp/ground_before.js
node benchmark/comparison/run_veripaper_web.mjs veripaper_web_before --src /tmp/ground_before.js

git clone https://github.com/DSL4-Digital/RefExists
REFEXISTS_VERIFIER=$PWD/RefExists/public/verifier.js \
REFEXISTS_COMMIT=$(git -C RefExists rev-parse HEAD) \
  node benchmark/comparison/run_refexists.mjs

pip install citegate==0.3.0
python3 benchmark/comparison/run_citegate.py

pip install "academic-refchecker[webui]==3.1.7"
python3 benchmark/comparison/run_refchecker.py

python3 benchmark/comparison/make_table.py --write  # regenerate the tables above
```

Each runner writes `comparison/results/<tool>.json` with tool version /
commit, input contract, configuration, UTC timestamps and every attempt.
refchecker's raw stdout/stderr per pass is kept in
`comparison/results/refchecker_raw/`.

## Limitations

- **Small n** (6–8 per category): signals, not rates.
- **First-party** construction and scoring (see the honesty statement).
- **Shared egress IP.** Registry rate budgets (Semantic Scholar especially)
  and source reachability (DBLP's bot-protection; intermittent OpenAlex
  search) shaped several outcomes for every tool. Runs from another network
  — or with each tool's optional free keys / `--mailto` — may differ.
- **Non-determinism.** Live registries; the citegate trial vs. scored run
  above differ on some samples. Re-run before quoting.
- **Input contracts differ by design**: veripaper gets the draft sentence,
  RefExists a reference string, citegate/refchecker a BibTeX entry
  transcribed from that string.
- Ground truth is the 2026-10-20 snapshot in `samples.json`; registries
  change (re-verify with `build_samples.py`).
- **Web runs use Node, not a browser.** `run_veripaper_web.mjs` evaluates
  the shipped `web/ground.js` unchanged, but Node does not enforce CORS and
  loads transformers.js from npm instead of the CDN. Every source the app
  uses was checked to send CORS headers to the live site's origin, and a
  headless-Chrome run of the app loaded the model from the CDN and produced
  the same labels on spot checks — but the scored numbers are from Node.
- The specific-not-in-abstract samples were built with the same
  deterministic check that now passes them (see the top section).

## Commercial tools (not tested): free tiers and terms

Research only, 2026-10-21: no account was created and nothing was run.
Quotes are from each tool's own pages on that date; terms change, and
"allowed" below is our reading, not legal advice.

| Tool | Free tier? | Manual testing / publishing results under its terms | Quote and source | Recommendation |
|---|---|---|---|---|
| **Citely** | **Yes, limited**: free credits on sign-up (the site says "3 free credits, valid for one year, no credit card"; its `llms.txt` says "two free citation checks"). Account needed | **Not prohibited.** The terms ban scraping/automation and misrepresenting a `not_found`; nothing against manual use or publishing results | "You may not: … probe, disrupt, overload, scrape, or reverse engineer the service …; represent a `not_found` result as conclusive proof of fabrication or misconduct." — [citely.ai/terms-of-service](https://citely.ai/terms-of-service) (effective 2026-07-21). Free allowance: [citely.ai/posts/best-citation-checkers-2026-what-they-actually-verify](https://citely.ai/posts/best-citation-checkers-2026-what-they-actually-verify), [citely.ai/llms.txt](https://citely.ai/llms.txt) | **Best candidate.** The owner can sign up personally, paste the reference strings by hand (existence categories only — it does not check claim support), publish verdicts verbatim, and phrase `Not found` as Citely defines it. The free credits probably cover only part of the 34 samples; a courtesy note to contact@citely.ai is cheap |
| **Scite Reference Check** | **No.** Reference Check is a premium feature; a 7-day trial needs an account and rolls into the chosen plan | **Not without permission.** Company Materials may not be published or displayed; classifier results may not be redistributed or used to evaluate AI models | "you agree not to license, distribute, copy, modify, publicly perform or display, transmit, publish … the Company Materials" and "you agree not to: … (b) store, redistribute … or otherwise make such content … available to any third party; or (c) use such content … to train, fine-tune, evaluate or otherwise improve any machine learning or artificial intelligence model" — [scite.ai/terms](https://scite.ai/terms). Premium/trial: [help.scite.ai Reference Check](https://help.scite.ai/en-us/article/how-do-i-use-the-scite-reference-check-xo6fv5/), [scite.ai/pricing](https://scite.ai/pricing/) | **Skip** unless Scite gives written permission. It also does a different job: it takes a manuscript PDF and reports editorial notices and supporting/contrasting citations; it does not test whether a reference exists |
| **Recite** (reciteworks.com) | **Yes, but not for this**: 2 uploads/day, first 2,500 words / 50 references, Google login. Crossref matching and retraction detection are paid-only | **No.** Results may not be shown in public or republished, and use that competes with Recite is excluded | "You must not republish material from our website (including republication on another website); … show any material from our website in public; … You must not use the Services for any purpose that competes with Recite" — [reciteworks.com/terms](https://reciteworks.com/terms) (updated 2025-12-12). Paid-only features: [reciteworks.com/help/free-vs-paid](https://reciteworks.com/help/free-vs-paid) | **Skip.** Its terms rule out publishing, and its free tier only matches in-text citations to the reference list |
| **GPTZero Hallucination Check** | **Unclear / probably no.** The free plan is AI detection only (10,000 words/month); citation features are on paid tiers per its support page | **Grey area.** No clause against publishing, but no commercial use without approval and no "disparaging" use; GPTZero publicly argues for "good faith benchmarking between competitors" | "The Site may not be used in connection with any commercial endeavors except those that are specifically endorsed or approved by us. … you agree not to: … Disparage, tarnish, or otherwise harm, in our opinion, us and/or the Site." — [gptzero.me/terms-of-use.html](https://gptzero.me/terms-of-use.html) (updated 2026-08-21). Plans: [support.gptzero.me](https://support.gptzero.me/articles/1272562776-what-is-the-difference-between-the-free-and-paid-for-plans). Benchmarking stance: [gptzero.me/news/gptzero-ai-detection-benchmarking-…](https://gptzero.me/news/gptzero-ai-detection-benchmarking-the-industry-standard-in-accuracy-transparency-and-fairness/) | **Ask first.** Email GPTZero for evaluation access, citing its own benchmarking stance; do not publish without it |
| **Sourcely** | **Yes, limited**: up to 300 characters per query, no commitment (per Citely's comparison) | **Not prohibited.** Short terms: use only through its interface, do not copy or redistribute the service; nothing about results | "Don't misuse our services. For example, don't interfere with our services or try to access them using a method other than the interface and the instructions that we provide." — [sourcely.net/terms-of-service](https://www.sourcely.net/terms-of-service) | **Low priority.** Mainly a source finder; its Real/Fake checks may be paid; manual testing is allowed if done through the website |

