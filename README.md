# veripaper (working name)

Open-source academic paper tool: **the paper is just the final presentation.**

Researchers should only do three things: **creative ideas, logical reasoning, empirical proof**.
Everything else — writing, benchmarking, venue targeting, rebuttals — is handled by the tool.

```
idea → proposal decision → idea distillation → evidence grounding → top-venue benchmarking → reviewer simulation → venue targeting → rebuttal → publishable
```

## How it differs from OpenDraft

OpenDraft (19 agents, MIT) solves "a draft in 10 minutes"; its strength is citation *existence* verification.
It admits: *"verifies sources exist, not that claims about their content are accurate."*

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

## Quickstart (v0.1)

```bash
pip install -e .
python -m veripaper ground draft.md --out report.md
```

Input: paper markdown. Output: claim-by-claim verification report.

## Roadmap

- v0.1: Evidence grounding (current state of this repo)
- v1.0 (Phase 1 assembly): end-to-end — proposal decision → impact assessment →
  productization direction → evidence grounding → template generation →
  venue auto-optimization → reviewer simulation → venue targeting →
  rebuttal management → acceptance-rate review loop (learning)
