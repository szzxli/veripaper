"""Citation existence verification: DOI → CrossRef/DataCite/arXiv lookup → metadata match.

Design rule: reject on failure, never fabricate.
Lookup order for DOIs: CrossRef first, then DataCite fallback (covers
arXiv 10.48550/ DOIs and other DataCite-registered records, which CrossRef
does not index).
"""
from __future__ import annotations

import re
import time

import requests

CROSSREF = "https://api.crossref.org/works/"
DATACITE = "https://api.datacite.org/dois/"
UA = {"User-Agent": "veripaper/0.1 (mailto:dev@veripaper.local)"}

# Retraction signals, both read from the CrossRef record already fetched
# (no extra request):
#  1. title prefix — publishers mark retracted titles "RETRACTED: …" or
#     (Springer Nature) "RETRACTED ARTICLE: …"; "WITHDRAWN: …" likewise;
#  2. the record's `updated-by` list — CrossRef attaches retraction /
#     withdrawal / removal notices here, including those from the Retraction
#     Watch database that CrossRef now hosts (source "retraction-watch").
# No signal means "unknown", never "not retracted".
RETRACTED_RE = re.compile(r"^\s*(retracted|withdrawn)(\s+article)?\s*:", re.I)
RETRACTION_UPDATE_TYPES = {"retraction", "withdrawal", "removal"}


def is_retracted_title(title: str | None) -> bool:
    return bool(RETRACTED_RE.match(title or ""))


def retraction_updates(msg: dict) -> list[str]:
    """Retraction-type notices in a CrossRef work's `updated-by` list."""
    out = []
    for u in (msg or {}).get("updated-by") or []:
        t = str((u or {}).get("type") or "").lower()
        if t in RETRACTION_UPDATE_TYPES:
            out.append(t)
    return out


def _get(url: str) -> requests.Response | None:
    """GET with 429 backoff (honor Retry-After, max 3 retries).

    After retries the 429 response is returned as-is so callers can mark
    the result rate-limited honestly — never laundered into a verdict.
    """
    for attempt in range(4):
        try:
            r = requests.get(url, timeout=15, headers=UA)
        except requests.RequestException:
            return None
        if r.status_code != 429 or attempt == 3:
            return r
        ra = 0
        try:
            ra = int(r.headers.get("Retry-After", "0"))
        except (TypeError, ValueError):
            pass
        time.sleep((ra if ra > 0 else 2 ** attempt) + 0.5)
    return None  # unreachable


def verify_doi(doi: str) -> dict:
    """Return {'exists', 'title', 'reason', 'limited', 'retracted'}.

    'limited' is True when every reachable source answered HTTP 429 —
    rate-limited is NOT not-found, and callers must say so explicitly.
    """
    doi = doi.strip()
    r = _get(CROSSREF + doi)
    # A network failure is "not checked", never "does not exist": reported
    # like a rate limit (limited=True) so it can't become FABRICATED.
    cr_unreachable = r is None
    if r is not None and r.status_code == 200:
        try:
            msg = r.json()["message"]
            title = (msg.get("title") or [None])[0]
            authors = [((a.get("given") or "") + " " + (a.get("family") or "")).strip()
                       for a in (msg.get("author") or [])][:8]
            authors = [a for a in authors if a]
        except (ValueError, KeyError):
            msg, title, authors = {}, None, []
        notices = retraction_updates(msg)
        return {"exists": True, "title": title, "reason": "crossref match",
                "limited": False,
                "retracted": is_retracted_title(title) or bool(notices),
                "authors": authors}
    cr_limited = (r is not None and r.status_code == 429)
    cr_desc = "crossref unreachable" if cr_unreachable else f"crossref http {r.status_code}"
    # Fallback: DataCite (arXiv DOIs live here, not in CrossRef)
    r2 = _get(DATACITE + doi)
    if r2 is None:
        return {"exists": False, "title": None,
                "reason": f"network: datacite unreachable ({cr_desc}) — not checked",
                "limited": True, "unreachable": True, "retracted": False}
    if r2.status_code == 429:
        return {"exists": False, "title": None,
                "reason": "rate-limited by crossref and datacite",
                "limited": True, "retracted": False}
    if r2.status_code != 200:
        not_checked = cr_limited or cr_unreachable
        return {"exists": False, "title": None,
                "reason": f"{cr_desc}, datacite http {r2.status_code}" + (" — not checked" if cr_unreachable else ""),
                "limited": not_checked, "unreachable": cr_unreachable, "retracted": False}
    try:
        attrs = r2.json()["data"]["attributes"]
        title = (attrs.get("titles") or [{}])[0].get("title")
        authors = [c.get("name") for c in (attrs.get("creators") or [])][:8]
        authors = [a for a in authors if a]
    except (ValueError, KeyError, IndexError, AttributeError):
        title, authors = None, []
    return {"exists": True, "title": title, "reason": "datacite match",
            "limited": False, "retracted": is_retracted_title(title),
            "authors": authors}


def verify_arxiv(arxiv_id: str) -> dict:
    """Existence check for an arXiv id: DataCite DOI first (also yields title),
    then export.arxiv.org as fallback."""
    aid = arxiv_id.strip()
    base = re.sub(r"v\d+$", "", aid, flags=re.I)
    d = verify_doi(f"10.48550/arXiv.{base}")
    if d["exists"]:
        return {"exists": True, "title": d["title"], "reason": "arxiv via datacite",
                "limited": False, "retracted": d["retracted"],
                "authors": d.get("authors", [])}
    if d["limited"]:
        return {"exists": False, "title": None, "reason": d["reason"],
                "limited": True, "retracted": False}
    url = f"https://export.arxiv.org/api/query?id_list={aid}"
    r = _get(url)
    if r is None:
        # DataCite (which holds a DOI for every arXiv paper) already answered
        # a clean "no such DOI"; arXiv itself could not be asked.
        return {"exists": False, "title": None,
                "reason": "datacite has no 10.48550/arXiv DOI for this id (arXiv API unreachable)",
                "limited": False, "retracted": False}
    ok = r.status_code == 200 and "<entry>" in r.text and base in r.text
    return {"exists": ok, "title": None,
            "reason": "arxiv match" if ok else "arxiv no entry",
            "limited": False, "retracted": False}
