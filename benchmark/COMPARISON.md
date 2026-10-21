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

## Tools tested

| Tool | Licence | Version / commit | How it was run | Input it got |
|---|---|---|---|---|
| **veripaper** (this repo) | MIT | Python pipeline, see provenance below | `comparison/run_veripaper.py`: `pipeline.run_ground`, default **no-key** configuration | `draft` (claim + citation, as a user pastes it) |
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
| veripaper BYOK LLM judge (claim support, `[SPECIFIC-NOT-IN-ABSTRACT]`) | not exercised | needs the user's own paid LLM key; that is why veripaper scores 0/6 on that row in its default configuration |
| [ValiRef](https://github.com/Gianthard-cyh/ValiRef) | not run | open source (MIT) but its verification is DeepSeek-LLM-driven and needs a paid API key |
| [hallucinator](https://github.com/gianlucasb/hallucinator) | not run (this round) | open source (AGPL-3.0), runnable in principle, but its input is PDF papers (the samples would have to be typeset into PDFs, a different input contract); its online DBLP backend is documented as broken (Anubis bot-protection) and its online OpenAlex backend expects an API key from an account signup. Candidate for a future round with an offline DBLP DB |
| [k-zhai/bibtex-verifier](https://github.com/k-zhai/bibtex-verifier) and other small repos found by search | not run | no licence file (use rights unclear) or not yet evaluated; suggestions welcome |
| Citely, RefCheck, Sourcely, TrueCite / WisPaper, Paperpal, Clarity | **not tested** | closed commercial web apps (paid, or free tiers only through an interactive website). We do not script or scrape closed web apps; no API we could call within their terms. 0 of 34 run |

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
| Category (n) | veripaper (before fix) | RefExists | citegate | refchecker (no-LLM) |
|---|---|---|---|---|
| real (8) | 7/8 recognised · 1 inconclusive | 8/8 recognised | 5/8 recognised · 3 metadata flag | 7/8 recognised · 1 metadata flag |
| fabricated (8) | 5/8 (3 inconclusive) | 5/8 (3 miss) | 7/8 (1 miss) | 6/8 (2 inconclusive) |
| chimeric (6) | 3/6 (1 miss, 2 inconclusive) | 3/6 (3 miss) | 4/6 (2 miss) | 6/6 |
| retracted (6) | 3/6 (3 miss) | 6/6 | 6/6 | 6/6 |
| specific-not-in-abstract (6) | 0/6 (6 miss) | out of scope | out of scope | out of scope |

Per-sample outcomes (verdict → outcome):

| Sample | veripaper (before fix) | RefExists | citegate | refchecker (no-LLM) |
|---|---|---|---|---|
| real-01 | CITED [STALE:2016] → pass | verified → pass | verified → pass | verified (retraction: clean) → pass |
| real-02 | CITED → pass | verified → pass | mismatch → metadata-flag | verified (retraction: no_doi) → pass |
| real-03 | CITED → pass | verified → pass | verified → pass | verified (retraction: no_doi) → pass |
| real-04 | CITED → pass | verified → pass | verified → pass | verified (retraction: clean) → pass |
| real-05 | RATE_LIMITED → inconclusive | likely → pass | mismatch → metadata-flag | suggestion (retraction: no_doi) → pass |
| real-06 | CITED → pass | verified → pass | verified → pass | verified (retraction: clean) → pass |
| real-07 | CITED → pass | verified → pass | mismatch → metadata-flag | warning (retraction: no_doi) → metadata-flag |
| real-08 | CITED → pass | verified → pass | verified → pass | verified (retraction: no_doi) → pass |
| fab-01 | FABRICATED → pass | not_found → pass | not-found → pass | unverified (retraction: unknown) → pass |
| fab-02 | FABRICATED → pass | not_found → pass | not-found → pass | unverified (retraction: unknown) → pass |
| fab-03 | FABRICATED → pass | not_found → pass | not-found → pass | unverified (retraction: no_doi) → inconclusive |
| fab-04 | FABRICATED → pass | partial → miss | not-found → pass | unverified (retraction: unknown) → pass |
| fab-05 | FABRICATED → pass | not_found → pass | not-found → pass | unverified (retraction: no_doi) → inconclusive |
| fab-06 | RATE_LIMITED → inconclusive | partial → miss | not-found → pass | unverified (retraction: no_doi) → pass |
| fab-07 | RATE_LIMITED → inconclusive | no_match → pass | mismatch → miss | unverified (retraction: no_doi) → pass |
| fab-08 | RATE_LIMITED → inconclusive | partial → miss | not-found → pass | unverified (retraction: no_doi) → pass |
| chim-01 | RATE_LIMITED → inconclusive | partial → pass | mismatch → pass | error (retraction: no_doi) → pass |
| chim-02 | CITED [CHIMERIC:author-mismatch] → pass | partial → pass | mismatch → pass | error (retraction: clean) → pass |
| chim-03 | CITED [CHIMERIC:author-mismatch] → pass | verified → miss | not-found → miss | error (retraction: no_doi) → pass |
| chim-04 | CITED [CHIMERIC:author-mismatch] → pass | verified → miss | mismatch → pass | error (retraction: clean) → pass |
| chim-05 | UNVERIFIED → miss | partial → pass | mismatch → pass | error (retraction: no_doi) → pass |
| chim-06 | RATE_LIMITED → inconclusive | no_match → miss | not-found → miss | error (retraction: no_doi) → pass |
| retr-01 | CITED [RETRACTED] → pass | verified + retracted → pass | retracted → pass | verified (retraction: retracted) → pass |
| retr-02 | CITED [RETRACTED] → pass | verified + retracted → pass | retracted → pass | verified (retraction: retracted) → pass |
| retr-03 | CITED [RETRACTED] → pass | verified + retracted → pass | retracted → pass | verified (retraction: retracted) → pass |
| retr-04 | CITED → miss | verified + retracted → pass | retracted → pass | verified (retraction: retracted) → pass |
| retr-05 | CITED → miss | verified + retracted → pass | retracted → pass | verified (retraction: retracted) → pass |
| retr-06 | CITED → miss | verified + retracted → pass | retracted → pass | verified (retraction: retracted) → pass |
| spec-01 | CITED → miss | verified → out-of-scope | verified → out-of-scope | verified (retraction: no_doi) → out-of-scope |
| spec-02 | CITED [STALE:2016] → miss | verified → out-of-scope | verified → out-of-scope | verified (retraction: clean) → out-of-scope |
| spec-03 | CITED → miss | verified → out-of-scope | mismatch → out-of-scope | verified (retraction: no_doi) → out-of-scope |
| spec-04 | CITED [STALE:2006] → miss | verified → out-of-scope | verified → out-of-scope | verified (retraction: no_doi) → out-of-scope |
| spec-05 | CITED → miss | verified → out-of-scope | not-found → out-of-scope | warning (retraction: no_doi) → out-of-scope |
| spec-06 | CITED → miss | verified → out-of-scope | mismatch → out-of-scope | error (retraction: no_doi) → out-of-scope |

Run provenance:

- **veripaper (before fix)** — tool: `veripaper (python pipeline, no-key default)`; commit: `605b409dbdf50df9abcff2ca6254f339f1c436fd`; input: `samples.json `draft``; run_finished_at: `2026-10-21T23:02:01+00:00`
- **RefExists** — tool: `RefExists (DSL4-Digital/RefExists)`; commit: `5fa3ffbaf3bc2f40877a5d3e2e446615455a5a62`; input: `samples.json `refexists_ref``; node: `v20.19.2`; run_finished_at: `2026-10-21T22:45:19Z`
- **citegate** — tool: `citegate`; version: `citegate 0.3.0`; commit: `94cc0a02a63a11154664c88b25923cbd0dc7c028`; input: `samples.bib (one entry per run)`; config: `defaults; --workers 1; no --mailto`; run_finished_at: `2026-10-21T22:29:10+00:00`
- **refchecker (no-LLM)** — tool: `refchecker (academic-refchecker)`; version: `3.1.7`; commit: `66d0cb59945474a1c9bd59df6e5b40c9d0c197d3`; input: `samples.bib`; config: `refchecker-webui check --no-llm --check-retractions --json --paper <bib>  (no LLM, no S2 key)`; run_finished_at: `2026-10-21T22:52:07+00:00`
<!-- GENERATED:END -->

## Reading the numbers

**veripaper's misses and gaps (default no-key configuration), before the
fix below:**

- **Retracted: 3/6.** It only read Crossref's `RETRACTED:` title prefix;
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

## Reproduce

```bash
pip install -e .                                    # veripaper (this repo)
python3 benchmark/comparison/run_veripaper.py veripaper_before

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
