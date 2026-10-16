"""论点内容核验（增量创新，OpenDraft 没有）：被引文献真支持该论点吗？

策略：取被引文献摘要（arXiv / Semantic Scholar 免费 API），用 LLM 判断
"摘要是否实质支持该论点"。只做降级不做定罪：
  支持 → [VERIFIED]；不确定/不支持 → [CITED] + 警告（最终判定权在作者）。
"""
from __future__ import annotations


def fetch_abstract(doi: str | None = None, arxiv_id: str | None = None) -> str | None:
    """取摘要；取不到返回 None（诚实降级，不编造）。"""
    # TODO(v0.1): 接 Semantic Scholar / arXiv API
    return None


def check_claim_support(claim: str, abstract: str | None) -> dict:
    """返回 {'verdict': 'verified'|'cited', 'reason': str}。"""
    if not abstract:
        return {"verdict": "cited", "reason": "no abstract available — downgraded honestly"}
    # TODO(v0.1): 接 LLM 做实质支持判断
    return {"verdict": "cited", "reason": "llm check not wired yet"}
