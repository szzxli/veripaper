"""Freshness check: claims carrying numbers must carry timestamps.

Stale data gets tagged [STALE:YYYY] with a suggestion to find a newer source.
Rules are configurable; defaults are placeholders pending tuning
(e.g. social-science stats older than 3 years, CS benchmarks older than 2).
"""
from __future__ import annotations

import re

STALE_AFTER_YEARS = 3
YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")


def extract_years(claim: str) -> list[int]:
    return [int(m.group(0)) for m in YEAR_RE.finditer(claim)]


def check_freshness(claim: str, current_year: int = 2026) -> dict:
    years = extract_years(claim)
    if not years:
        return {"stale": False, "reason": "no timestamp found"}
    newest = max(years)
    if current_year - newest > STALE_AFTER_YEARS:
        return {"stale": True, "reason": f"data from {newest} — suggest newer source",
                "tag": f"[STALE:{newest}]"}
    return {"stale": False, "reason": f"data from {newest}, within window"}
