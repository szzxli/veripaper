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

from veripaper.verify.extract import ARXIV_RE, DOI_RE, REF_HEADING_RE

UA = {"User-Agent": "veripaper/0.1 (mailto:dev@veripaper.local)"}
CROSSREF_QUERY = "https://api.crossref.org/works"

YEAR_RE = re.compile(r"\b((?:19|20)\d{2})\b")
NUMERIC_ENTRY_RE = re.compile(r"^\[(\d{1,3})\]\s*(.*)$")
CITEKEY_ENTRY_RE = re.compile(r"^\[@([^\]]+)\]\s*(.*)$")


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def split_references(markdown: str) -> tuple[str, str]:
    """Return (body, references_section). Section is '' when absent."""
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
        doi = m.group(1).rstrip(".,;:")
    for m in ARXIV_RE.finditer(entry):
        aid = m.group(1)
        if doi and aid in doi:
            continue
        arxiv_id = aid
        break
    y = YEAR_RE.search(entry)
    return {"doi": doi, "arxiv_id": arxiv_id,
            "year": int(y.group(1)) if y else None}


def parse_references(markdown: str) -> dict:
    """Parse the References section.

    Returns {'numeric': {n: entry}, 'citekey': {k: entry},
             'authoryear': {(surname, year): [entries]}},
    where entry = {'raw', 'doi', 'arxiv_id', 'year'}.
    """
    _, section = split_references(markdown)
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
        # author-year key: first surname + year
        sm = re.match(r"\s*([A-Z][A-Za-z'’\-]+)", raw)
        if sm and entry["year"]:
            surname = sm.group(1).lower()
            refmap["authoryear"].setdefault((surname, entry["year"]), []).append(entry)
        # entries that match nothing are still kept for bibliographic query
        refmap.setdefault("unkeyed", []).append(entry)
    return refmap


def _parse_intext_authoryear(marker: str) -> tuple[str, int] | None:
    sm = re.match(r"\s*([A-Za-z'’\-]+)", marker)
    y = YEAR_RE.search(marker)
    if not sm or not y:
        return None
    surname = re.sub(r"[^a-z]", "", sm.group(1).lower())
    if surname in ("et", ""):
        return None
    return surname, int(y.group(1))


def _crossref_lookup(entry_raw: str, entry_year: int | None) -> str | None:
    """Unstructured bibliographic query; accept only on title-in-entry + year match."""
    q = re.sub(r"^\[(@?[^\]]+)\]\s*", "", entry_raw).strip()[:500]
    if len(q) < 15:
        return None
    try:
        r = requests.get(CROSSREF_QUERY, params={
            "query.bibliographic": q, "rows": 3,
            "select": "DOI,title,published,author",
        }, headers=UA, timeout=20)
    except requests.RequestException:
        return None
    if r.status_code != 200:
        return None
    try:
        items = r.json()["message"]["items"]
    except (ValueError, KeyError):
        return None
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
            return doi
    return None


def resolve_marker(marker_type: str, marker_id: str, refmap: dict) -> dict:
    """Resolve an in-text marker to identifiers.

    Returns {'doi', 'arxiv_id', 'via', 'note'}; doi/arxiv_id None when unresolved.
    via: embedded | crossref | none. Ambiguity → none + note.
    """
    entry = None
    if marker_type == "numeric":
        entry = refmap.get("numeric", {}).get(marker_id)
    elif marker_type == "citekey":
        entry = refmap.get("citekey", {}).get(marker_id)
    elif marker_type == "author-year":
        parsed = _parse_intext_authoryear(marker_id)
        if parsed:
            cands = refmap.get("authoryear", {}).get(parsed, [])
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
                "via": "embedded", "note": "identifier found in reference entry"}
    doi = _crossref_lookup(entry["raw"], entry["year"])
    if doi:
        return {"doi": doi, "arxiv_id": None, "via": "crossref",
                "note": "CrossRef bibliographic match (title-in-entry + year)"}
    return {"doi": None, "arxiv_id": None, "via": "none",
            "note": "reference entry has no DOI/arXiv ID and no confident CrossRef match"}
