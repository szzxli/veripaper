"""Reference-list resolution: turn in-text markers into verifiable identifiers.

Real papers cite as (Author, 2020) or [1] far more often than raw DOIs.
This module parses the References/Bibliography section and resolves markers:

  1. Embedded identifiers — DOI / arXiv ID inside the entry (deterministic).
  2. CrossRef bibliographic query — for entries without IDs. Accepts the top
     hit ONLY if its normalized title appears verbatim in the entry text
     (and the year matches when the entry carries one). Otherwise UNVERIFIED.

Never guesses: ambiguous or low-confidence matches stay UNVERIFIED.
"""
from __future__ import annotations

import difflib
import re
import urllib.parse

import requests

from veripaper.verify.extract import (
    ARXIV_RE, DOI_RE, REF_HEADING_RE, clean_doi, normalize_ref_heading, normalize_ws,
)

UA = {"User-Agent": "veripaper/0.1 (mailto:dev@veripaper.local)"}
CROSSREF_QUERY = "https://api.crossref.org/works"

YEAR_RE = re.compile(r"\b((?:19|20)\d{2})\b")
YEAR_LETTER_RE = re.compile(r"\b((?:19|20)\d{2})([a-z])?\b")
NUMERIC_ENTRY_RE = re.compile(r"^\[(\d{1,3})\]\s*(.*)$")
CITEKEY_ENTRY_RE = re.compile(r"^\[@([^\]]+)\]\s*(.*)$")


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def split_references(markdown: str) -> tuple[str, str]:
    """Return (body, references_section). Section is '' when absent."""
    markdown = normalize_ref_heading(markdown)
    m = REF_HEADING_RE.search(markdown)
    if not m:
        return markdown, ""
    return markdown[:m.start()], markdown[m.end():]


def _split_entries(section: str) -> list[str]:
    # Split on numeric markers first (multiline), then on blank lines within
    # each part. Handles single-style lists and mixed content gracefully.
    entries: list[str] = []
    for part in re.split(r"(?m)^(?=\[\d{1,3}\])", section):
        part = part.strip()
        if not part:
            continue
        chunks = [c.strip() for c in re.split(r"\n\s*\n", part) if c.strip()]
        for c in chunks:
            # rejoin wrapped lines inside one entry
            c = " ".join(c.splitlines())
            if c and not c.lstrip().startswith("#"):
                entries.append(c)
    return entries


def _entry_ids(entry: str) -> dict:
    doi = arxiv_id = None
    m = DOI_RE.search(entry)
    if m:
        doi = clean_doi(m.group(1))
    for m in ARXIV_RE.finditer(entry):
        aid = m.group(1)
        if doi and aid in doi:
            continue
        arxiv_id = aid
        break
    y = YEAR_RE.search(entry)
    yl = YEAR_LETTER_RE.search(entry)
    return {"doi": doi, "arxiv_id": arxiv_id,
            "year": int(y.group(1)) if y else None,
            "ykey": (int(yl.group(1)), yl.group(2) or "") if yl else (None, "")}


def parse_references(markdown: str) -> dict:
    """Parse the References section.

    Returns {'numeric': {n: entry}, 'citekey': {k: entry},
             'authoryear': {(surname, year): [entries]}},
    where entry = {'raw', 'doi', 'arxiv_id', 'year'}.
    """
    _, section = split_references(normalize_ws(markdown))
    refmap: dict = {"numeric": {}, "citekey": {}, "authoryear": {}}
    for raw in _split_entries(section):
        entry = {"raw": raw, **_entry_ids(raw)}
        m = NUMERIC_ENTRY_RE.match(raw)
        if m:
            refmap["numeric"][m.group(1)] = entry
            continue
        m = CITEKEY_ENTRY_RE.match(raw)
        if m:
            refmap["citekey"][m.group(1).strip()] = entry
            continue
        # author-year key: first surname + year (+ disambiguation letter)
        sm = re.match(r"\s*([A-Z][A-Za-z'’\-]+)", raw)
        if sm and entry["ykey"][0]:
            key = (sm.group(1).lower(), entry["ykey"][0], entry["ykey"][1])
            refmap["authoryear"].setdefault(key, []).append(entry)
        # entries that match nothing are still kept for bibliographic query
        refmap.setdefault("unkeyed", []).append(entry)
    return refmap


def _parse_intext_authoryear(marker: str) -> tuple[str, int, str] | None:
    sm = re.match(r"\s*([A-Za-z'’\-]+)", marker)
    y = YEAR_LETTER_RE.search(marker)
    if not sm or not y:
        return None
    surname = re.sub(r"[^a-z]", "", sm.group(1).lower())
    if surname in ("et", ""):
        return None
    return surname, int(y.group(1)), y.group(2) or ""


def detect_chimeric(entry_raw: str, authors: list[str] | str | None) -> bool:
    """True when the title matches a real paper but the authors named in the
    entry match none of the paper's real authors (chimeric hallucination).

    Only judges when the entry actually names authors (et al. / "Surname, I."
    pattern); author-less entries are not flaggable.
    """
    if isinstance(authors, str):
        arr = [a.strip() for a in authors.split(",") if a.strip()]
    else:
        arr = [str(a) for a in (authors or [])]
    fams = []
    for a in arr:
        parts = re.split(r"[\s,]+", a.strip())
        parts = [p for p in parts if p]
        fam = parts[0] if "," in a else (parts[-1] if parts else "")
        fam = re.sub(r"[^a-z]", "", fam.lower())
        if len(fam) > 1:
            fams.append(fam)
    if not fams or not entry_raw:
        return False
    if not re.search(r"et al\.|[A-Z][a-z]{1,},\s*[A-Z]\.", entry_raw):
        return False
    words = set(re.findall(r"[a-z]{2,}", entry_raw.lower()))
    return not any(f in words for f in fams)


def _s2_lookup(entry_raw: str, entry_year: int | None) -> dict:
    """Semantic Scholar title search; same title-in-entry + year gate.
    Returns {'doi', 'arxiv_id', 'limited'}. S2 has the best CS/ML coverage,
    which CrossRef lacks (many NeurIPS/ICML papers)."""
    none = {"doi": None, "arxiv_id": None, "limited": False}
    q = re.sub(r"^\[(@?[^\]]+)\]\s*", "", entry_raw).strip()[:300]
    if len(q) < 15:
        return none
    try:
        r = requests.get(
            "https://api.semanticscholar.org/graph/v1/paper/search",
            params={"query": q, "fields": "title,abstract,externalIds,year",
                    "limit": 3},
            headers=UA, timeout=20)
    except requests.RequestException:
        return none
    if r.status_code == 429:
        return {"doi": None, "arxiv_id": None, "limited": True}
    if r.status_code != 200:
        return none
    try:
        data = r.json().get("data", [])
    except ValueError:
        return none
    norm_entry = _norm(entry_raw)
    for p in data:
        title = p.get("title") or ""
        if len(_norm(title)) < 10:
            continue
        if _norm(title) not in norm_entry:
            continue
        if entry_year and p.get("year") and abs(p["year"] - entry_year) > 1:
            continue
        ids = p.get("externalIds") or {}
        doi = ids.get("DOI")
        arxiv = ids.get("ArXiv")
        if doi or arxiv:
            return {"doi": doi, "arxiv_id": arxiv, "limited": False}
    return none


def _dblp_lookup(entry_raw: str, entry_year: int | None) -> dict:
    """DBLP title search (computer-science bibliography); same acceptance gate.
    Returns {'doi', 'arxiv_id', 'limited'}."""
    none = {"doi": None, "arxiv_id": None, "limited": False}
    q = re.sub(r"^\[(@?[^\]]+)\]\s*", "", entry_raw).strip()[:300]
    if len(q) < 15:
        return none
    try:
        r = requests.get(
            "https://dblp.org/search/publ/api/",
            params={"q": q, "format": "json", "h": 3},
            headers=UA, timeout=20)
    except requests.RequestException:
        return none
    if r.status_code == 429:
        return {"doi": None, "arxiv_id": None, "limited": True}
    if r.status_code != 200:
        return none
    try:
        hits = (r.json().get("result") or {}).get("hits", {}).get("hit", [])
    except ValueError:
        return none
    norm_entry = _norm(entry_raw)
    for h in hits:
        info = (h or {}).get("info") or {}
        title = re.sub(r"<[^>]*>", "", str(info.get("title") or ""))
        if len(_norm(title)) < 10:
            continue
        if _norm(title) not in norm_entry:
            continue
        try:
            y = int(str(info.get("year") or "")[:4])
        except ValueError:
            y = None
        if entry_year and y and abs(y - entry_year) > 1:
            continue
        if info.get("doi"):
            return {"doi": str(info["doi"]), "arxiv_id": None, "limited": False}
    return none


def _bibliographic_lookup(entry_raw: str, entry_year: int | None) -> dict:
    """CrossRef, Semantic Scholar, then DBLP. Same acceptance gate."""
    cr = _crossref_lookup(entry_raw, entry_year)
    if cr["doi"]:
        return {"doi": cr["doi"], "arxiv_id": None, "via": "crossref", "limited": False}
    s2 = _s2_lookup(entry_raw, entry_year)
    if s2["doi"] or s2["arxiv_id"]:
        return {"doi": s2["doi"], "arxiv_id": s2["arxiv_id"],
                "via": "semanticscholar", "limited": False}
    db = _dblp_lookup(entry_raw, entry_year)
    if db["doi"]:
        return {"doi": db["doi"], "arxiv_id": None, "via": "dblp", "limited": False}
    return {"doi": None, "arxiv_id": None, "via": "none",
            "limited": bool(cr["limited"] or s2["limited"] or db["limited"])}


def _crossref_lookup(entry_raw: str, entry_year: int | None) -> dict:
    """Unstructured bibliographic query; accept only on title-in-entry + year match.
    Returns {'doi', 'arxiv_id', 'limited'}."""
    none = {"doi": None, "arxiv_id": None, "limited": False}
    q = re.sub(r"^\[(@?[^\]]+)\]\s*", "", entry_raw).strip()[:500]
    if len(q) < 15:
        return none
    try:
        r = requests.get(CROSSREF_QUERY, params={
            "query.bibliographic": q, "rows": 3,
            "select": "DOI,title,published,author",
        }, headers=UA, timeout=20)
    except requests.RequestException:
        return none
    if r.status_code == 429:
        return {"doi": None, "arxiv_id": None, "limited": True}
    if r.status_code != 200:
        return none
    try:
        items = r.json()["message"]["items"]
    except (ValueError, KeyError):
        return none
    norm_entry = _norm(entry_raw)
    for it in items:
        title = ((it.get("title") or [""])[0])
        if not title or len(_norm(title)) < 10:
            continue
        if _norm(title) not in norm_entry:
            continue  # title must literally appear in the entry
        if entry_year:
            try:
                pub = (it.get("published") or {}).get("date-parts", [[None]])[0][0]
            except (IndexError, TypeError):
                pub = None
            if pub and abs(pub - entry_year) > 1:
                continue
        doi = it.get("DOI")
        if doi:
            return {"doi": doi, "arxiv_id": None, "limited": False}
    return none


def resolve_marker(marker_type: str, marker_id: str, refmap: dict) -> dict:
    """Resolve an in-text marker to identifiers.

    Returns {'doi', 'arxiv_id', 'via', 'note', 'entry_raw', 'limited'}.
    'entry_raw' on success paths (for chimeric detection); 'limited' True when
    every source answered HTTP 429 — rate-limited is NOT not-found.
    via: embedded | crossref | semanticscholar | none. Ambiguity → none + note.
    """
    entry = None
    if marker_type == "numeric":
        entry = refmap.get("numeric", {}).get(marker_id)
    elif marker_type == "citekey":
        entry = refmap.get("citekey", {}).get(marker_id)
    elif marker_type == "author-year":
        parsed = _parse_intext_authoryear(marker_id)
        if parsed:
            amap = refmap.get("authoryear", {})
            cands = amap.get(parsed, [])
            if not cands:
                # fallback: ignore the disambiguation letter
                cands = [e for k, es in amap.items()
                         if k[:2] == parsed[:2] for e in es]
            if len(cands) == 1:
                entry = cands[0]
            elif len(cands) > 1:
                return {"doi": None, "arxiv_id": None, "via": "none",
                        "note": f"ambiguous: {len(cands)} entries match '{marker_id}'"}
    if entry is None:
        return {"doi": None, "arxiv_id": None, "via": "none",
                "note": f"no reference entry for [{marker_id}]"}
    if entry["doi"] or entry["arxiv_id"]:
        return {"doi": entry["doi"], "arxiv_id": entry["arxiv_id"],
                "via": "embedded", "entry_raw": entry["raw"],
                "note": "identifier found in reference entry"}
    bl = _bibliographic_lookup(entry["raw"], entry["year"])
    if bl["doi"] or bl["arxiv_id"]:
        src = {"crossref": "CrossRef", "dblp": "DBLP"}.get(bl["via"], "Semantic Scholar")
        return {"doi": bl["doi"], "arxiv_id": bl["arxiv_id"], "via": bl["via"],
                "entry_raw": entry["raw"],
                "note": f"{src} bibliographic match (title-in-entry + year)"}
    return {"doi": None, "arxiv_id": None, "via": "none",
            "limited": bool(bl.get("limited")),
            "note": ("sources rate-limited while checking this entry — "
                     "not checked, not proven fake") if bl.get("limited")
            else "reference entry has no DOI/arXiv ID and no confident bibliographic match"}
