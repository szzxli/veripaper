"""Claim-content verification:
does the cited work actually support the claim?

Strategy: fetch the cited work's abstract (free via arXiv / Semantic Scholar),
then use an LLM to judge whether the abstract substantively supports the claim.
Downgrade-only, never a conviction:
  supported → [VERIFIED]; uncertain/unsupported → [CITED] + warning (author decides).
"""
from __future__ import annotations


def fetch_abstract(doi: str | None = None, arxiv_id: str | None = None) -> str | None:
    """Fetch abstract; return None when unavailable (honest downgrade, never fabricate)."""
    # TODO(v0.1): wire Semantic Scholar / arXiv APIs
    return None


def check_claim_support(claim: str, abstract: str | None) -> dict:
    """Return {'verdict': 'verified'|'cited', 'reason': str}."""
    if not abstract:
        return {"verdict": "cited", "reason": "no abstract available — downgraded honestly"}
    # TODO(v0.1): wire an LLM for the substantive-support judgment
    return {"verdict": "cited", "reason": "llm check not wired yet"}
