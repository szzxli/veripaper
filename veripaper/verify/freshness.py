"""数据新鲜度：带数字的论断强制抽时间戳，过期标 [STALE:YYYY] 并推荐新数据源。

规则可配：默认社科统计 >3 年、CS 基准 >2 年即标过期（占位值，待调参）。
"""
from __future__ import annotations

import re

STALE_AFTER_YEARS = 3
YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")


def extract_years(claim: str) -> list[int]:
    return [int(y) for y in YEAR_RE.findall(claim)] and \
        [int(m.group(0)) for m in YEAR_RE.finditer(claim)]


def check_freshness(claim: str, current_year: int = 2026) -> dict:
    years = extract_years(claim)
    if not years:
        return {"stale": False, "reason": "no timestamp found"}
    newest = max(years)
    if current_year - newest > STALE_AFTER_YEARS:
        return {"stale": True, "reason": f"data from {newest} — suggest newer source",
                "tag": f"[STALE:{newest}]"}
    return {"stale": False, "reason": f"data from {newest}, within window"}
