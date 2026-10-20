# Benchmark results — 2026-10-20

Set: `samples.json` v1.0, n = 34 (real 8, fabricated 8, chimeric 6,
retracted 6, specific-not-in-abstract 6). Method and pre-registered
scoring rules: `METHOD.md`. Raw outputs: `results_veripaper.json`,
`results_refexists.json`.

Tools: veripaper (this repo's Python pipeline, default no-key
configuration) and RefExists (DSL4-Digital/RefExists, MIT, commit
`5fa3ffbaf3bc2f40877a5d3e2e446615455a5a62`, unmodified).

## Scoreboard

| Category | n | veripaper | RefExists |
|---|---|---|---|
| real | 8 | 7 pass, **1 false alarm**, 0 inconclusive | 8 pass |
| fabricated | 8 | 6 pass, 0 miss, 2 inconclusive | 4 pass, 3 miss, 1 inconclusive |
| chimeric | 6 | 3 pass, 0 miss, 3 inconclusive | 3 pass, 2 miss, 1 inconclusive |
| retracted | 6 | 3 pass, **3 miss** | 6 pass |
| specific-not-in-abstract | 6 | 0 pass, **6 miss** (see note) | out of scope by design |

Note on the last row: veripaper's specificity backstop only engages after
a BYOK LLM judge returns SUPPORTED. In the default no-key configuration
benchmarked here it never engages, so all six claims came back `CITED`
with a keyword-overlap hint. The deterministic absence of the specifics
was verified at construction time; a BYOK run of this category is future
work. RefExists checks existence only and states so itself; all six
underlying references verified as real.

## What the runs actually showed

**Real citations.** veripaper recognised 7 of 8. The false alarm is
real-05 — "Vaswani, A., et al. Attention is all you need. NeurIPS 2017.",
a short-form entry with no identifier: on the one attempt that was not
rate-limited, veripaper's bibliographic gate (registry title must appear
verbatim in the entry, year within ±1) found no confident match and the
sample came back `UNVERIFIED`. RefExists resolved the same entry as
`likely`. Short-form entries for conference papers are a veripaper weak
spot.

**Fabricated.** Every fabricated identifier (5/5) was caught by both
tools' registries checks (veripaper `FABRICATED`, RefExists
`not_found` for 4 of 5). The exception is instructive: fab-04's invented
DOI is unregistered, but RefExists returned `partial` with
`doiUnresolved` — the entry text matched the CVPR 2024 proceedings
record (confidence 0.85), and its documented behaviour is to suspect a
typo'd DOI rather than accuse fabrication. The two invented entries
without identifiers that RefExists could check (fab-06, fab-08) also
came back `partial`: topically adjacent real works were found (a 2023
quantum-routing paper; "HYPDAE", 2025) and flagged for human review
instead of `no_match`. veripaper caught one of the three no-identifier
entries (fab-07, `UNVERIFIED`); fab-06 and fab-08 stayed `RATE_LIMITED`
through three attempts — bibliographic resolution depends on Semantic
Scholar's unauthenticated search, whose quota was exhausted from this
network. fab-07 errored twice for RefExists (a registry in its lookup
path was unreachable from this network) and is inconclusive there.

**Chimeric.** veripaper flagged all three samples it could resolve to a
verdict (chim-02 via Crossref bibliographic match; chim-03 and chim-04
via their embedded identifiers). The other three (chim-01, chim-05,
chim-06 — all entries without identifiers) stayed rate-limited through
three attempts. RefExists flagged the three no-identifier entries it
could check as `partial` (record found, metadata only partially
matching), but returned `verified` for chim-03 and chim-04: with a real
identifier, a verbatim-matching title and a matching year, its grading
corroborates on title + year even though the listed authors are wrong.

**Retracted.** The clearest split in the set. RefExists flagged 6/6 via
OpenAlex's `is_retracted`. veripaper flagged 3/6: it reads Crossref's
title prefix, and only the `RETRACTED: …` format matches its pattern.
retr-04, retr-05 and retr-06 are Crossref records whose titles begin
`RETRACTED ARTICLE: …` — the signal is present in the same registry,
in a format variant the checker does not match.

**Specifics absent from the abstract.** Untested-by-design in the
default configuration (see the note above). This is the category where
veripaper claims its differentiation, and it is gated behind the user's
own LLM key; the benchmark records that as a miss for the default
product rather than assuming the BYOK path performs.

## Not run

| Tool | Status |
|---|---|
| Citely | Paid (from $14–19/mo). Not purchased, no trial signup. **To be added if a budget exists.** |
| RefCheck | Free tier is 5 checks/day through its interactive website; there is no scriptable endpoint we could exercise. 0 of 34 run. **To be added via a manual session.** |
| Sourcely, TrueCite/WisPaper, Paperpal, Clarity | Paid or platform-bundled; not run for the same budget reason as Citely. |

## Caveats

- Small n per category (5–8): read these as signals, not rates.
- 5 veripaper samples and 2 RefExists samples ended inconclusive
  (registry rate limits / reachability from a shared egress IP), after
  the documented retries. They are counted as inconclusive everywhere,
  never as misses.
- Two cosmetic defects in veripaper's shipped report writer were
  observed during the run and do not affect base labels: bracketed tags
  are duplicated in finding headers (e.g. `[RETRACTED] [RETRACTED]`),
  and the freshness check can read a "year" out of an identifier (a DOI
  containing `2016` produced a `[STALE:2016]` tag on real-01 / spec-02;
  an arXiv ID produced `[STALE:2006]` on spec-04). Labels in the table
  below are shown de-duplicated; raw labels are in the JSON files.
- Registry contents drift; ground truth was verified on 2026-10-20.

## Per-sample detail

| Sample | veripaper label | veripaper outcome | RefExists status | RefExists outcome |
|---|---|---|---|---|
| real-01 | CITED [STALE:2016] | pass | verified | pass |
| real-02 | CITED | pass | verified | pass |
| real-03 | CITED | pass | verified | pass |
| real-04 | CITED | pass | verified | pass |
| real-05 | UNVERIFIED | false-alarm | likely | pass |
| real-06 | CITED | pass | verified | pass |
| real-07 | CITED | pass | verified | pass |
| real-08 | CITED | pass | verified | pass |
| fab-01 | FABRICATED | pass | not_found | pass |
| fab-02 | FABRICATED | pass | not_found | pass |
| fab-03 | FABRICATED | pass | not_found | pass |
| fab-04 | FABRICATED | pass | partial | miss |
| fab-05 | FABRICATED | pass | not_found | pass |
| fab-06 | RATE_LIMITED | inconclusive-rate-limited | partial | miss |
| fab-07 | UNVERIFIED | pass | error | inconclusive-error |
| fab-08 | RATE_LIMITED | inconclusive-rate-limited | partial | miss |
| chim-01 | RATE_LIMITED | inconclusive-rate-limited | partial | pass |
| chim-02 | CITED [CHIMERIC:author-mismatch] | pass | partial | pass |
| chim-03 | CITED [CHIMERIC:author-mismatch] | pass | verified | miss |
| chim-04 | CITED [CHIMERIC:author-mismatch] | pass | verified | miss |
| chim-05 | RATE_LIMITED | inconclusive-rate-limited | partial | pass |
| chim-06 | RATE_LIMITED | inconclusive-rate-limited | error | inconclusive-error |
| retr-01 | CITED [RETRACTED] | pass | verified + retracted | pass |
| retr-02 | CITED [RETRACTED] | pass | verified + retracted | pass |
| retr-03 | CITED [RETRACTED] | pass | verified + retracted | pass |
| retr-04 | CITED | miss | verified + retracted | pass |
| retr-05 | CITED | miss | verified + retracted | pass |
| retr-06 | CITED | miss | verified + retracted | pass |
| spec-01 | CITED | miss | verified | out-of-scope-claim-support |
| spec-02 | CITED [STALE:2016] | miss | verified | out-of-scope-claim-support |
| spec-03 | CITED | miss | verified | out-of-scope-claim-support |
| spec-04 | CITED [STALE:2006] | miss | verified | out-of-scope-claim-support |
| spec-05 | CITED | miss | verified | out-of-scope-claim-support |
| spec-06 | CITED | miss | verified | out-of-scope-claim-support |
