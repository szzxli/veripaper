"""Deterministic claim–citation extraction from markdown.

Finds citation markers and attaches each to its containing sentence.
No LLM: predictable, testable, offline. An LLM pass can refine later.

Supported marker styles:
  [@key]  pandoc citekey
  [1] [12]  numeric brackets
  (Author, 2020) (Author et al., 2020) (Author & Lee 2021)
  10.xxxx/xxxxx  bare DOI (or https://doi.org/10.xxxx/xxxxx)
  1706.03762 / arXiv:1706.03762 / hep-th/9901001
  https://...  bare URLs

Stops at a References/Bibliography heading (reference lists are not claims).
Code blocks are skipped.
"""
from __future__ import annotations

import re

# --- marker patterns (ordered: most specific first) ---
DOI_RE = re.compile(r"(?:https?://(?:dx\.)?doi\.org/)?(10\.\d{4,}/[^\s\]\"'<>]+)", re.I)


def clean_doi(raw: str) -> str:
    """Strip trailing punctuation and unbalanced trailing ')'.

    DOIs may legally contain balanced parentheses (e.g. Wiley's
    10.1016/S0140-6736(97)11096-0); the regex lets them through and this
    keeps them, trimming only what cannot be part of the DOI.
    """
    d = re.sub(r"[.,;:]+$", "", raw or "")
    while d.endswith(")") and d.count("(") < d.count(")"):
        d = re.sub(r"[.,;:]+$", "", d[:-1])
    return d
ARXIV_RE = re.compile(r"(?:arXiv:)?(\d{4}\.\d{4,5}(?:v\d+)?|[a-z\-]+/\d{7}(?:v\d+)?)", re.I)
PANDOC_RE = re.compile(r"\[@([^\]]+)\]")
NUMERIC_RE = re.compile(r"\[(\d{1,3})\]")
# IEEE-style grouped citations: [1, 2, 5-7] -> 1, 2, 5, 6, 7
BRACKET_RE = re.compile(r"\[([^\[\]]{1,40})\]")
_RANGE_RE = re.compile(r"^(\d{1,3})\s*[-–—]\s*(\d{1,3})$")


def expand_numeric_group(inner: str) -> list[str]:
    ids: list[str] = []
    for part in re.split(r"[,;]", inner):
        p = part.strip()
        rm = _RANGE_RE.match(p)
        if rm:
            a, b = int(rm.group(1)), int(rm.group(2))
            if a <= b and b - a <= 50:
                ids.extend(str(i) for i in range(a, b + 1))
            else:
                ids.extend([rm.group(1), rm.group(2)])
        elif re.fullmatch(r"\d{1,3}", p):
            ids.append(p)
    return ids
AUTHOR_YEAR_RE = re.compile(
    r"\(\s*([A-Z][A-Za-z'’\-]+(?:\s+et al\.)?(?:\s*(?:&|and)\s+[A-Z][A-Za-z'’\-]+)?"
    r"(?:\s*,\s*[A-Z][A-Za-z'’\-]+)*,?\s*\d{4}[a-z]?(?:\s*;\s*[^)]+)?)\s*\)")
URL_RE = re.compile(r"https?://[^\s\]\)\"'<>]+", re.I)

REF_HEADING_RE = re.compile(r"^(?:#{1,6}\s*)?(references|bibliography|works cited)\b", re.I | re.M)
REF_HEADING_INLINE_RE = re.compile(r"([.!?:])\s*(#{1,6}\s*(?:references|bibliography|works cited)\b)", re.I)


def normalize_ref_heading(text: str) -> str:
    """Break an inline references heading onto its own line.

    Pasted drafts often run the heading together with body text
    ("...folding [1]. ## References [1] Smith..."), which the
    line-anchored heading regex would otherwise miss — reference
    entries then leak into claims as fragments/duplicates.
    """
    return REF_HEADING_INLINE_RE.sub(r"\1\n\2", text)
FENCE_RE = re.compile(r"```.*?```", re.S)
SENT_SPLIT_RE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'“(\[])")

# unicode spaces that sneak in from PDF/HTML pastes and break literal matches
WS_NORM_RE = re.compile(r"[\u00a0\u2007\u202f\u2009\u200a]")


def normalize_ws(text: str) -> str:
    return WS_NORM_RE.sub(" ", text)

ABBREV = {"et al.", "e.g.", "i.e.", "Fig.", "fig.", "Eq.", "vs.", "U.S.", "U.K."}


def _strip_code(text: str) -> str:
    return FENCE_RE.sub("", text)


def _cut_references(text: str) -> str:
    text = normalize_ref_heading(text)
    m = REF_HEADING_RE.search(text)
    return text[:m.start()] if m else text


def _sentences(text: str) -> list[str]:
    # protect abbreviations before splitting
    prot = text
    for i, ab in enumerate(ABBREV):
        prot = prot.replace(ab, f"\x00{i}\x00")
    parts = SENT_SPLIT_RE.split(prot)
    out = []
    for p in parts:
        for i, ab in enumerate(ABBREV):
            p = p.replace(f"\x00{i}\x00", ab)
        p = " ".join(p.split())
        if p:
            out.append(p)
    return out


def _markers(sentence: str) -> list[dict]:
    found: list[dict] = []
    seen: set[str] = set()

    def add(raw: str, cite_type: str, cite_id: str):
        key = (cite_type, cite_id)
        if key in seen:
            return
        seen.add(key)
        found.append({"raw": raw, "type": cite_type, "id": cite_id})

    for m in DOI_RE.finditer(sentence):
        doi = clean_doi(m.group(1))
        # avoid double-counting arXiv IDs as DOIs handled separately is fine;
        # DOI form wins when explicit
        add(m.group(0), "doi", doi)
    for m in ARXIV_RE.finditer(sentence):
        aid = m.group(1)
        # skip if this span is inside an already-found DOI marker
        if any(f["type"] == "doi" and aid in f["id"] for f in found):
            continue
        add(m.group(0), "arxiv", aid)
    for m in PANDOC_RE.finditer(sentence):
        add(m.group(0), "citekey", m.group(1).strip())
    # numeric brackets: skip if part of pandoc or already consumed
    for m in NUMERIC_RE.finditer(sentence):
        if any(f["type"] == "citekey" and m.group(0) in f["raw"] for f in found):
            continue
        add(m.group(0), "numeric", m.group(1))
    # grouped brackets: [1, 2, 5-7] -> individual numeric markers
    for m in BRACKET_RE.finditer(sentence):
        inner = m.group(1).strip()
        if not re.match(r"\d", inner) or not re.search(r"[,;–—-]", inner):
            continue
        if any(f["type"] == "citekey" and m.group(0) in f["raw"] for f in found):
            continue
        for nid in expand_numeric_group(inner):
            add("[" + nid + "]", "numeric", nid)
    for m in AUTHOR_YEAR_RE.finditer(sentence):
        add(m.group(0), "author-year", m.group(1))
    for m in URL_RE.finditer(sentence):
        url = m.group(0).rstrip(".,;:")
        if "doi.org" in url:
            continue  # already captured as DOI
        if any(f["type"] in ("doi", "arxiv") and url in f["raw"] for f in found):
            continue
        add(url, "url", url)
    return found


def extract_pairs(markdown: str) -> list[dict]:
    """Return [{'claim', 'cite_raw', 'cite_type', 'cite_id', 'sentence_no'}]."""
    text = _cut_references(_strip_code(normalize_ws(markdown)))
    # drop headings (keep body sentences)
    lines = [ln for ln in text.splitlines() if not ln.lstrip().startswith("#")]
    text = "\n".join(lines)
    pairs = []
    for si, sent in enumerate(_sentences(text)):
        for mk in _markers(sent):
            pairs.append({
                "claim": sent,
                "cite_raw": mk["raw"],
                "cite_type": mk["type"],
                "cite_id": mk["id"],
                "sentence_no": si,
            })
    return pairs
