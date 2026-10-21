# veripaper benchmark

A public citation-checking benchmark: 34 constructed samples with
ground truth verified live against Crossref / DataCite / arXiv /
OpenAlex at build time, across five categories — real, fabricated,
chimeric (real title, wrong authors), retracted, and
specific-not-in-abstract.

- `METHOD.md` — construction, tools, configurations, pre-registered
  scoring rules, limitations
- `RESULTS.md` — the 2026-10-20 scored runs (veripaper + RefExists),
  including every miss, false alarm and inconclusive sample
- `samples.json` — the sample set (drafts, bibliography-form strings,
  per-sample ground truth and its basis)
- `build_samples.py` — rebuilds the set, re-verifying ground truth live;
  drops any candidate that fails verification
- `run_veripaper.py` / `run_refexists.mjs` — the scoring runners
  (`retry_limited.py` / `retry_refexists.mjs` perform the documented
  retries for rate-limited / error samples)
- `results_veripaper.json` / `results_refexists.json` — raw per-sample
  outputs, all attempts preserved
- `COMPARISON.md` — **comparative run (2026-10-21)**: veripaper vs.
  RefExists, citegate and refchecker on the same samples, plus what was not
  tested and why; runners, raw results and generated tables in
  `comparison/`, the BibTeX form of the samples in `samples.bib`

First-party constructed and published with its misses visible — see the
honesty statement in `METHOD.md`. Independent re-runs are the point;
corrections via issues/PRs.
