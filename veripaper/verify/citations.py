"""Citation existence verification: DOI → CrossRef/arXiv lookup → metadata match.

Design rule: reject on failure, never fabricate.
"""
from __future__ import annotations

import requests

CROSSREF = "https://api.crossref.org/works/"


def verify_doi(doi: str) -> dict:
    """Return {'exists': bool, 'title': str|None, 'reason': str}."""
    doi = doi.strip()
    try:
        r = requests.get(CROSSREF + doi, timeout=15,
                         headers={"User-Agent": "veripaper/0.1 (mailto:dev@veripaper.local)"})
    except requests.RequestException as e:
        return {"exists": False, "title": None, "reason": f"network: {e}"}
    if r.status_code != 200:
        return {"exists": False, "title": None, "reason": f"crossref http {r.status_code}"}
    try:
        title = (r.json()["message"].get("title") or [None])[0]
    except (ValueError, KeyError):
        title = None
    return {"exists": True, "title": title, "reason": "crossref match"}


def verify_arxiv(arxiv_id: str) -> dict:
    """Existence check for an arXiv id via export.arxiv.org."""
    url = f"https://export.arxiv.org/api/query?id_list={arxiv_id.strip()}"
    try:
        r = requests.get(url, timeout=15)
    except requests.RequestException as e:
        return {"exists": False, "title": None, "reason": f"network: {e}"}
    ok = "<entry>" in r.text and arxiv_id.split("v")[0] in r.text
    return {"exists": ok, "title": None,
            "reason": "arxiv match" if ok else "arxiv no entry"}
