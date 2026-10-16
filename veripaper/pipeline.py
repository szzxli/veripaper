"""Phase 2 · 证据锚定：输入论文 markdown，输出逐条核验报告。

流水线（v0.1）：
  draft.md → 抽取论点+引用 → 引用存在性核验 → 论点内容核验 → 数据新鲜度 → report.md
"""
from __future__ import annotations

from .verify import citations, claims, freshness


def run_ground(draft_path: str, out_path: str) -> str:
    text = open(draft_path, encoding="utf-8").read()
    # TODO(v0.1): 用 LLM 抽取 (论点, 引用) 对；当前为占位实现
    findings: list[str] = []
    findings.append("TODO: claim extraction not yet implemented — wire an LLM here.")
    report = "# 核验报告（v0.1 骨架）\n\n" + "\n".join(f"- {f}" for f in findings)
    open(out_path, "w", encoding="utf-8").write(report)
    return out_path
