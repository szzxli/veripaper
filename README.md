# veripaper — catch hallucinated citations in AI-written research drafts

> **Your AI wrote the draft. Did it invent the citations?** veripaper checks every cited source against CrossRef, arXiv, Semantic Scholar and other registries, flags references that don't exist, and labels each claim honestly. Free and open source (MIT).
>
> **▶ Live demo:** https://szzxli.github.io/veripaper/web/ — paste a draft or upload .docx/.pdf; everything runs in your browser, nothing is uploaded.

*(veripaper is a working name.)*

Open-source academic paper tool: **the paper is just the final presentation.**

**Live workbench (runs in your browser, no install):** https://szzxli.github.io/veripaper/web/

Researchers should only do three things: **creative ideas, logical reasoning, empirical proof**.
Everything else — writing, benchmarking, venue targeting, rebuttals — is handled by the tool.

The tool automates bureaucratic taxes on thinking, not thinking itself.
It can't give you taste — taste is the whole PhD.

```
idea → proposal decision → idea distillation → evidence grounding → top-venue benchmarking → reviewer simulation → venue targeting → rebuttal → publishable
```

## What it does differently

Draft-generation tools solve "a draft in 10 minutes"; their strength is citation
*existence* verification — checking that sources exist, not that claims about
their content are accurate.

veripaper solves "getting published":
- **Claim-level verification**: not just "does the citation exist", but "does the cited work actually support your claim"
- **Idea-first**: start from your rough idea; distill its academic value (novelty / contribution statement)
- **Reviewer simulation**: pre-submission critique in the voice of the target venue, focused on evidence gaps and stale data
- **Rebuttal assistance**: point-by-point response drafting, tone calibration, revision tracking

## Iron rules

1. Every citation must come from a real retrieval result. **Fabricating citations is forbidden.**
2. Honest labels: `[VERIFIED]` / `[CITED]` / `[UNVERIFIED]` / `[STALE:YYYY]` / `[EXTRAPOLATED]` —
   downgrade rather than pretend verification happened.
3. The tool assists writing; it does not replace research. Final judgment always belongs to the author.
4. **The rules apply to the tool itself** (dogfood): documentation, marketing claims,
   and tool outputs all get the same honest labels. An illustrative number is labeled
   illustrative — never presented as measured.
5. **Lookup, not generation**: the verifier generates nothing — it only queries
   databases (CrossRef, arXiv, OpenAlex) and reports back. Hallucinations happen when
   AI *invents* references; asking "does this DOI resolve" is a lookup, a different
   failure mode entirely.
6. **Lightweight by design**: verification is database lookups, not model training.
   The heaviest operation is an HTTP GET. No GPU farms required to check a citation.
7. **Nuance over binary** (from r/PhD feedback): a reference can be real, relevant,
   and still not support the specific claim. Claim-level verification must report
   *which parts* are supported — "supports the method claim, silent on the
   generalization, weaker sample than implied" — with quotes, never a flat yes/no.
   Today's `[CITED]` label is the honest placeholder for this until then.

## Quickstart (v0.1)

```bash
pip install -e .
python -m veripaper ground draft.md --out report.md
```

Input: paper markdown. Output: claim-by-claim verification report.

**BibTeX input.** Give it a `.bib` instead (`python -m veripaper ground refs.bib --out report.md`,
or paste/upload the `.bib` in the web app) and every entry is checked by DOI /
arXiv ID / title lookup with the same labels (`CITED` / `UNVERIFIED` /
`FABRICATED` / `RATE_LIMITED` + `[CHIMERIC]` / `[RETRACTED]`). Parsing happens
locally — in the web app, entirely in your browser; the only network traffic is
the registry lookups. A `.bib` carries no claims, so this mode is
existence-level: no claim-support judgment and no freshness tags.

## Claim support without an API key (web app)

The web app checks claims against the cited paper's abstract **for free, with
no key and no server**:

- **Deterministic checks** (no model): the claim's hard specifics — numbers,
  percentages, quoted phrases, acronyms — and named entities (datasets,
  models such as `CoLA`, `RoBERTa`, `ResNet-50`) must appear in the
  abstract. Missing hard specifics give `[SPECIFIC-NOT-IN-ABSTRACT]` (or
  `[POSSIBLE-MISATTRIBUTION]` when the number shows up in a paper the cited
  work itself cites).
- **A small NLI model in your browser**: `cross-encoder/nli-deberta-v3-xsmall`
  (ONNX, quantized, ~87 MB, via [transformers.js](https://github.com/huggingface/transformers.js)).
  It is downloaded once, on the first claim that has an abstract (not on
  page load), cached by the browser, and runs locally. Your draft is never
  sent anywhere. A keyless `ABSTRACT-SUPPORTED` needs high entailment, no
  contradictory passage and no missing specifics/entities, and is tagged
  `[KEYLESS-NLI]`.
- **Honest scope**: abstract only, and a much smaller model than an LLM —
  treat it as a screen, not a verdict. Retracted or chimeric citations are
  never labelled supported. Untick "Keyless claim check" to skip the model.
- **Optional higher-accuracy path**: paste your own OpenRouter key and an
  LLM judges each claim against the abstract instead (bring-your-own-key;
  the deterministic backstop still applies).

## Free sources, rate limits and caching

Every lookup goes to a free, keyless public index, in this order:
Crossref (polite pool, `mailto`) → DataCite (also covers every arXiv paper
via its `10.48550/arXiv.*` DOI — arXiv's own API is not reachable from a
browser) → OpenAlex → DBLP → **Semantic Scholar last, only if nothing else
matched**. Abstracts come from the Crossref record, DataCite, OpenAlex
single-record lookups and Europe PMC before Semantic Scholar.

Requests go through one queue with per-host pacing, exponential backoff with
jitter on HTTP 429/503 that honours `Retry-After` (seconds or HTTP-date), and
a per-host cooldown: when a source says "come back in 30 minutes" the app
does not wait — it skips that source and moves on. Results are cached in
`localStorage` (metadata 7 days, abstracts and judgments 30 days; rate-limited
results are never cached). A reference entry without DOI is labelled
`RATE_LIMITED` only when fewer than two indexes could answer; if two or more
answered "no match", it is `UNVERIFIED` and the note names the sources that
were rate-limited. Keyless OpenAlex search shares a small daily budget per IP
address (the `mailto` parameter does not raise it), which matters on shared
networks.

## Benchmark

A public citation-checking benchmark (34 samples, ground truth verified
live against the registries): [benchmark/](benchmark/) — construction
and scoring rules in `benchmark/METHOD.md`. **Latest scored runs, with
before/after numbers for the web app and a comparison with other
open-source checkers** (RefExists, citegate, refchecker — same samples,
per-category detection, false alarms, veripaper's own misses, and the
tools we could not test and why):
[benchmark/COMPARISON.md](benchmark/COMPARISON.md). (`benchmark/RESULTS.md`
holds only a pointer; the 2026-10-20 first run is in git history.)

## Roadmap

- v0.1: Evidence grounding (current state of this repo)
- v1.0 (Phase 1 assembly): end-to-end — proposal decision → impact assessment →
  productization direction → evidence grounding → template generation →
  venue auto-optimization → reviewer simulation → venue targeting →
  rebuttal management → acceptance-rate review loop (learning)

## Privacy

Privacy: we count anonymous page views with [GoatCounter](https://www.goatcounter.com) — no cookies, no personal data, no consent banner needed. Your content never goes to the counter: anything you type, paste or upload stays in your browser (except requests you start yourself, such as an AI-grading or lookup call to a provider you choose). Exactly what is sent is documented at the top of the site's `analytics.js`.
