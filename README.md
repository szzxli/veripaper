# veripaper (working name)

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

## Benchmark

A public citation-checking benchmark (34 samples, ground truth verified
live against the registries): [benchmark/](benchmark/) — construction
and scoring rules in `benchmark/METHOD.md`, latest scored runs
(veripaper + RefExists, misses included) in `benchmark/RESULTS.md`.

## Roadmap

- v0.1: Evidence grounding (current state of this repo)
- v1.0 (Phase 1 assembly): end-to-end — proposal decision → impact assessment →
  productization direction → evidence grounding → template generation →
  venue auto-optimization → reviewer simulation → venue targeting →
  rebuttal management → acceptance-rate review loop (learning)
