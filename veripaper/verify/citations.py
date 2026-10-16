"""Citation existence verification: DOI → CrossRef/DataCite/arXiv lookup → metadata match.

Design rule: reject on failure, never fabricate.
Lookup order for DOIs: CrossRef first, then DataCite fallback (covers
arXiv 10.48550/ DOIs and other DataCite-registered records, which CrossRef
does not index).
"""
from __future__ import annotations

import requests

CROSSREF = "https://api.crossref.org/works/"
DATACITE = "https://api.datacite.org/dois/"
UA = {"User-Agent": "veripaper/0.1 (mailto:dev@veripaper.local)"}


def _get(url: str) -> requests.Response | None:
    try:
        return requests.get(url, timeout=15, headers=UA)
    except requests.RequestException:
        return None


def verify_doi(doi: str) -> dict:
    """Return {'exists': bool, 'title': str|None, 'reason': str}."""
    doi = doi.strip()
    r = _get(CROSSREF + doi)
    if r is None:
        return {"exists": False, "title": None, "reason": "network: crossref unreachable"}
    if r.status_code == 200:
        try:
            title = (r.json()["message"].get("title") or [None])[0]
        except (ValueError, KeyError):
            title = None
        return {"exists": True, "title": title, "reason": "crossref match"}
    # Fallback: DataCite (arXiv DOIs live here, not in CrossRef)
    r2 = _get(DATACITE + doi)
    if r2 is None:
        return {"exists": False, "title": None, "reason": "network: datacite unreachable"}
    if r2.status_code != 200:
        return {"exists": False, "title": None,
                "reason": f"crossref http {r.status_code}, datacite http {r2.status_code}"}
    try:
        attrs = r2.json()["data"]["attributes"]
        title = (attrs.get("titles") or [{}])[0].get("title")
    except (ValueError, KeyError, IndexError, AttributeError):
        title = None
    return {"exists": True, "title": title, "reason": "datacite match"}


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
