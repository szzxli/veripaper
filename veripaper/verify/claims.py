"""Claim-content verification: does the cited work actually support the claim?

Abstract sources, in priority order (first hit wins):
  1. arXiv API          — for arXiv IDs and 10.48550/ DOIs (no key needed)
  2. DataCite           — descriptions with descriptionType=Abstract
  3. Semantic Scholar   — optional S2_API_KEY env; graceful on 429
  4. OpenAlex           — abstract_inverted_index reconstruction; graceful on 429

Support judgment goes through veripaper.llm (BYOK). No key or no abstract
→ honest downgrade to [CITED]; never a fabricated verdict.
"""
from __future__ import annotations

import os
import re
import xml.etree.ElementTree as ET

import requests

from veripaper import llm

UA = {"User-Agent": "veripaper/0.1 (mailto:dev@veripaper.local)"}
ARXIV_API = "https://export.arxiv.org/api/query?id_list="
DATACITE_API = "https://api.datacite.org/dois/"
S2_API = "https://api.semanticscholar.org/graph/v1/paper/DOI:"
OPENALEX_API = "https://api.openalex.org/works/https://doi.org/"


def _get(url: str, headers: dict | None = None, timeout: int = 20):
    try:
        h = dict(UA)
        if headers:
            h.update(headers)
        r = requests.get(url, headers=h, timeout=timeout)
        return r if r.status_code == 200 else None
    except requests.RequestException:
        return None


def _arxiv_abstract(arxiv_id: str) -> str | None:
    r = _get(ARXIV_API + arxiv_id.strip())
    if r is None:
        return None
    try:
        root = ET.fromstring(r.text)
        ns = {"a": "http://www.w3.org/2005/Atom"}
        entry = root.find("a:entry", ns)
        if entry is None:
            return None
        title_el = entry.find("a:title", ns)
        if title_el is not None and title_el.text and title_el.text.strip().lower().startswith("error"):
            return None
        summary = entry.find("a:summary", ns)
        if summary is not None and summary.text:
            return " ".join(summary.text.split())
    except ET.ParseError:
        return None
    return None


def _datacite_abstract(doi: str) -> str | None:
    r = _get(DATACITE_API + doi.strip())
    if r is None:
        return None
    try:
        descs = r.json()["data"]["attributes"].get("descriptions") or []
        for d in descs:
            if (d.get("descriptionType") or "").lower() == "abstract" and d.get("description"):
                return " ".join(d["description"].split())
    except (ValueError, KeyError, AttributeError):
        return None
    return None


def _s2_abstract(doi: str) -> str | None:
    headers = {}
    key = os.environ.get("S2_API_KEY", "").strip()
    if key:
        headers["x-api-key"] = key
    r = _get(S2_API + doi.strip() + "?fields=title,abstract", headers)
    if r is None:
        return None
    try:
        ab = r.json().get("abstract")
        return " ".join(ab.split()) if ab else None
    except ValueError:
        return None


def _openalex_abstract(doi: str) -> str | None:
    r = _get(OPENALEX_API + doi.strip())
    if r is None:
        return None
    try:
        inv = r.json().get("abstract_inverted_index")
        if not inv:
            return None
        pos: dict[int, str] = {}
        for word, idxs in inv.items():
            for i in idxs:
                pos[i] = word
        return " ".join(pos[i] for i in sorted(pos))
    except (ValueError, KeyError, AttributeError):
        return None


def fetch_abstract(doi: str | None = None, arxiv_id: str | None = None) -> str | None:
    """Fetch abstract; None when unavailable (honest downgrade, never fabricate)."""
    if arxiv_id:
        ab = _arxiv_abstract(arxiv_id)
        if ab:
            return ab
    if doi:
        d = doi.strip()
        if d.lower().startswith("10.48550/"):
            # arXiv DOI → resolve the arXiv id directly
            m = re.search(r"arxiv\.(\d{4}\.\d{4,5}(?:v\d+)?|[a-z\-]+/\d{7}(?:v\d+)?)",
                          d, re.I)
            if m:
                ab = _arxiv_abstract(m.group(1))
                if ab:
                    return ab
        for fn in (_datacite_abstract, _s2_abstract, _openalex_abstract):
            ab = fn(d)
            if ab:
                return ab
    return None


def check_claim_support(claim: str, abstract: str | None, title: str = "") -> dict:
    """Return {'verdict': 'verified'|'cited', 'reason': str}.

    Downgrade-only: supported → verified; anything uncertain → cited + note.
    """
    res = llm.judge_support(claim, abstract, title)
    if res["verdict"] == "supported":
        return {"verdict": "verified", "reason": res["reason"]}
    if res["verdict"] == "partial":
        return {"verdict": "cited",
                "reason": "partial support only — author decides (" + res["reason"] + ")"}
    return {"verdict": "cited", "reason": res["reason"]}
