"""Claim-content verification: does the cited work actually support the claim?

Abstract sources, in priority order (first hit wins):
  1. arXiv API          — for arXiv IDs and 10.48550/ DOIs (no key needed)
  2. DataCite           — descriptions with descriptionType=Abstract
  3. Semantic Scholar   — optional S2_API_KEY env; graceful on 429
  4. Europe PMC         — biomedical/life-science abstracts
  5. OpenAlex           — abstract_inverted_index reconstruction; graceful on 429

Support judgment goes through veripaper.llm (BYOK). No key or no abstract
→ honest downgrade to [CITED]; never a fabricated verdict.
"""
from __future__ import annotations

import os
import re
import time
import xml.etree.ElementTree as ET

import requests

from veripaper import llm

UA = {"User-Agent": "veripaper/0.1 (mailto:dev@veripaper.local)"}
ARXIV_API = "https://export.arxiv.org/api/query?id_list="
DATACITE_API = "https://api.datacite.org/dois/"
S2_API = "https://api.semanticscholar.org/graph/v1/paper/DOI:"
OPENALEX_API = "https://api.openalex.org/works/https://doi.org/"
EPMC_API = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"


def _get(url: str, headers: dict | None = None, timeout: int = 20):
    h = dict(UA)
    if headers:
        h.update(headers)
    for attempt in range(4):
        try:
            r = requests.get(url, headers=h, timeout=timeout)
        except requests.RequestException:
            return None
        if r.status_code != 429 or attempt == 3:
            return r if r.status_code == 200 else None
        ra = 0
        try:
            ra = int(r.headers.get("Retry-After", "0"))
        except (TypeError, ValueError):
            pass
        time.sleep((ra if ra > 0 else 2 ** attempt) + 0.5)
    return None  # unreachable


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


def _europepmc_abstract(doi: str) -> str | None:
    """Europe PMC abstract (biomedical/life-science coverage)."""
    from urllib.parse import quote
    url = (EPMC_API + "?query=" + quote(f'DOI:"{doi.strip()}"')
           + "&format=json&resultType=core&pageSize=1")
    r = _get(url)
    if r is None:
        return None
    try:
        res = (r.json().get("resultList") or {}).get("result") or []
        if not res:
            return None
        ab = (res[0].get("abstractText") or "").strip()
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
        for fn in (_datacite_abstract, _s2_abstract, _europepmc_abstract,
                   _openalex_abstract):
            ab = fn(d)
            if ab:
                return ab
    return None


def check_claim_support(claim: str, abstract: str | None, title: str = "",
                         doi: str | None = None) -> dict:
    """Return {'verdict': 'verified'|'cited', 'reason': str, 'tag': str}.

    Downgrade-only: supported → verified; anything uncertain → cited + note.
    Specificity backstop: hard specifics in the claim but absent from the
    abstract make a 'supported' suspect (paraphrase / misattribution) —
    downgraded to cited with an explanatory tag.
    """
    res = llm.judge_support(claim, abstract, title)
    if res["verdict"] == "supported":
        missing = specifics_missing_from_abstract(claim, abstract or "")
        if missing:
            shown = "; ".join(missing[:3])
            hit = check_citation_chain(doi, missing) if doi else None
            if hit:
                return {"verdict": "cited", "tag": " [POSSIBLE-MISATTRIBUTION]",
                        "reason": (f"claim leans on specifics absent from the abstract ({shown}) — "
                                   f"\"{hit['specific']}\" appears in \"{hit['title']}\", a paper this work cites. "
                                   f"The finding may originate there; verify the true source. Author decides.")}
            return {"verdict": "cited", "tag": " [SPECIFIC-NOT-IN-ABSTRACT]",
                    "reason": (f"claim cites specifics not found in the abstract ({shown}) — "
                               f"support is thin; check the full text. Author decides.")}
        return {"verdict": "verified", "tag": "",
                "reason": res["reason"] + " (abstract-level — full text not checked)"}
    if res["verdict"] == "partial":
        return {"verdict": "cited", "tag": "",
                "reason": "partial support only — author decides (" + res["reason"] + ")"}
    return {"verdict": "cited", "tag": "", "reason": res["reason"]}


_STOP = set(("a an the and or but if then else when while of at by for with about into through "
             "during before after above below to from up down in out on off over under again further "
             "once here there all any both each few more most other some such no nor not only own same "
             "so than too very can will just should now is are was were be been being have has had having "
             "do does did doing would could ought i you he she it we they them his her its our their "
             "this that these those as also which who whom what where why how because until between "
             "among per via using used use based et al").split())

_NUM_RE = re.compile(r"(\d+(?:\.\d+)?\s*%|p\s*[<>=]\s*0\.\d+|\d+(?:\.\d+)?\s*[KMB]\b|\b\d+\.\d+\b)", re.I)
_QUOTE_RE = re.compile(r'"([^"]{3,80})"')
_ACR_RE = re.compile(r"\b([A-Z]{3,}(?:[-_][A-Z0-9]+)?)\b")
_DOI_RE = re.compile(r"\b10\.\d{4,}/[^\s\]]+", re.I)
_ARXIV_RE = re.compile(r"\barXiv:\d{4}\.\d{4,5}(?:v\d+)?", re.I)


def _norm_loose(s: str | None) -> str:
    s = (s or "").lower()
    s = re.sub(r"\bmillion\b", "m", s)
    s = re.sub(r"\bbillion\b", "b", s)
    s = re.sub(r"\bthousand\b", "k", s)
    s = re.sub(r"\bpercent\b", "%", s)
    return re.sub(r"[^a-z0-9.%]", "", s)


def extract_specifics(claim: str) -> list[str]:
    """Hard specifics a paraphrase often drops: numbers, quoted phrases, acronyms.

    Citation markers are not specifics: '10.1000' inside a DOI is not a finding.
    """
    text = _DOI_RE.sub(" ", claim or "")
    text = _ARXIV_RE.sub(" ", text)
    out: list[str] = []
    seen: set[str] = set()

    def add(s: str) -> None:
        k = s.lower()
        if k and k not in seen:
            seen.add(k)
            out.append(s)

    for m in _NUM_RE.finditer(text):
        add(re.sub(r"\s+", "", m.group(1)))
    for m in _QUOTE_RE.finditer(text):
        add(m.group(1))
    for m in _ACR_RE.finditer(text):
        if m.group(1).lower() not in _STOP:
            add(m.group(1))
    return out


def specifics_missing_from_abstract(claim: str, abstract: str | None) -> list[str]:
    ab = _norm_loose(abstract)
    missing = []
    for sp in extract_specifics(claim):
        n = _norm_loose(sp)
        if len(n) >= 2 and n not in ab:
            missing.append(sp)
    return missing


def fetch_openalex_refs(doi: str) -> list[dict]:
    """Paper B's reference list via OpenAlex (best-effort; [] on any failure)."""
    try:
        r = _get(OPENALEX_API + doi, timeout=20)
        if r is None:
            return []
        ids = [str(u).split("/")[-1] for u in (r.json().get("referenced_works") or [])[:40]]
        ids = [i for i in ids if i]
        if not ids:
            return []
        r2 = _get("https://api.openalex.org/works?filter=openalex:" + "|".join(ids) +
                  "&select=id,doi,title&per-page=40", timeout=20)
        if r2 is None:
            return []
        return [{"title": w.get("title") or "", "doi": w.get("doi") or ""}
                for w in (r2.json().get("results") or [])]
    except Exception:
        return []


def check_citation_chain(doi: str | None, missing: list[str]) -> dict | None:
    """Does a missing specific surface in a paper B cites? → misattribution signal."""
    if not doi or not missing:
        return None
    for sp in missing:
        n = _norm_loose(sp)
        for ref in fetch_openalex_refs(doi):
            if ref["title"] and n in _norm_loose(ref["title"]):
                return {"specific": sp, "title": ref["title"], "doi": ref["doi"]}
    return None
