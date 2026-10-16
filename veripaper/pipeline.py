"""Phase 2 · Evidence grounding: paper markdown in, claim-by-claim verification report out.

Pipeline (v0.1):
  draft.md → extract claims+citations → citation existence check
           → claim-content check → freshness check → report.md
"""
from __future__ import annotations


def run_ground(draft_path: str, out_path: str) -> str:
    text = open(draft_path, encoding="utf-8").read()
    # TODO(v0.1): extract (claim, citation) pairs with an LLM; placeholder for now
    findings: list[str] = []
    findings.append("TODO: claim extraction not yet implemented — wire an LLM here.")
    report = "# Verification report (v0.1 skeleton)\n\n" + "\n".join(f"- {f}" for f in findings)
    open(out_path, "w", encoding="utf-8").write(report)
    return out_path
