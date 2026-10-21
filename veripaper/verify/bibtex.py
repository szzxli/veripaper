"""BibTeX entry point — Python parity of web/bibtex.js.

A .bib file is parsed locally and turned into an ordinary reference list
(one `[@key] Authors. Title. Venue, Year. doi:… arXiv:…` line per entry plus
one marker sentence per entry), which then runs through the same pipeline and
labels as a draft. A .bib has no claims, so bib mode is existence-level only:
no abstract fetch, no claim-support judgment, no freshness tags.
"""
from __future__ import annotations

import re

_MONTHS = {k: v for k, v in zip(
    "jan feb mar apr may jun jul aug sep oct nov dec".split(),
    "January February March April May June July August September October November December".split())}


def _read_value(s: str, i: int, strings: dict) -> tuple[str, int]:
    out = ""
    n = len(s)
    while i < n:
        while i < n and s[i].isspace():
            i += 1
        c = s[i] if i < n else ""
        if c == "{":
            depth, j = 0, i
            while j < n:
                if s[j] == "\\":
                    j += 2
                    continue
                if s[j] == "{":
                    depth += 1
                elif s[j] == "}":
                    depth -= 1
                    if depth == 0:
                        break
                j += 1
            out += s[i + 1:j]
            i = j + 1
        elif c == '"':
            depth, j = 0, i + 1
            while j < n:
                if s[j] == "\\":
                    j += 2
                    continue
                if s[j] == "{":
                    depth += 1
                elif s[j] == "}":
                    depth -= 1
                elif s[j] == '"' and depth == 0:
                    break
                j += 1
            out += s[i + 1:j]
            i = j + 1
        else:
            m = re.match(r"[^\s,#}]+", s[i:])
            tok = m.group(0) if m else ""
            out += tok if tok.isdigit() else strings.get(tok.lower(), tok)
            i += len(tok) or 1
        while i < n and s[i].isspace():
            i += 1
        if i < n and s[i] == "#":
            i += 1
            continue
        break
    return out, i


def _fields(body: str, strings: dict) -> dict:
    fields, i = {}, 0
    while i < len(body):
        m = re.match(r"[\s,]*([A-Za-z][\w\-:.]*)\s*=", body[i:])
        if not m:
            break
        i += m.end()
        val, i = _read_value(body, i, strings)
        fields[m.group(1).lower()] = re.sub(r"\s+", " ", val).strip()
    return fields


def parse_bibtex(text: str) -> tuple[list[dict], list[str]]:
    """Return (entries, errors); entry = {'key', 'type', 'fields'}."""
    s = text or ""
    entries, errors = [], []
    strings = dict(_MONTHS)
    pos = 0
    rx = re.compile(r"@\s*([A-Za-z]+)\s*([{(])")
    while True:
        m = rx.search(s, pos)
        if not m:
            break
        typ, opn = m.group(1).lower(), m.group(2)
        cls = "}" if opn == "{" else ")"
        depth, j = 0, m.end() - 1
        while j < len(s):
            ch = s[j]
            if ch == "\\":
                j += 2
                continue
            if ch == opn or (opn == "(" and ch == "{"):
                depth += 1
            elif ch == cls or (opn == "(" and ch == "}"):
                depth -= 1
                if depth == 0:
                    break
            j += 1
        if j >= len(s):
            errors.append(f"unterminated @{typ} entry at offset {m.start()}")
            break
        body = s[m.end():j]
        pos = j + 1
        if typ in ("comment", "preamble"):
            continue
        if typ == "string":
            strings.update(_fields(body, strings))
            continue
        km = re.match(r"\s*([^,\s]+)\s*,", body)
        if not km:
            errors.append(f"@{typ} entry without a citation key at offset {m.start()}")
            continue
        entries.append({"key": km.group(1), "type": typ,
                        "fields": _fields(body[km.end():], strings)})
    return entries, errors


_ACC = {
    '"': dict(a="ä", o="ö", u="ü", e="ë", i="ï", A="Ä", O="Ö", U="Ü"),
    "'": dict(a="á", e="é", i="í", o="ó", u="ú", c="ć", n="ń", s="ś", z="ź", E="É", A="Á"),
    "`": dict(a="à", e="è", i="ì", o="ò", u="ù"),
    "^": dict(a="â", e="ê", i="î", o="ô", u="û"),
    "~": dict(n="ñ", a="ã", o="õ", N="Ñ"),
    "c": dict(c="ç", C="Ç"),
    "v": dict(c="č", s="š", z="ž", r="ř", e="ě", C="Č", S="Š", Z="Ž"),
}


def clean_latex(v: str) -> str:
    s = v or ""
    s = re.sub(r"\\([\" '`^~cv])\s*\{?\\?([A-Za-z])\}?",
               lambda m: _ACC.get(m.group(1), {}).get(m.group(2), m.group(2)), s)
    s = (re.sub(r"\\ss\b\s*", "ß", s))
    s = re.sub(r"\\o\b\s*", "ø", s)
    s = re.sub(r"\\aa\b\s*", "å", s)
    s = s.replace("\\&", "&").replace("\\%", "%").replace("\\_", "_").replace("~", " ")
    s = re.sub(r"-{2,3}", "-", s)
    s = re.sub(r"\\(?:emph|textit|textbf|textsc|mathrm|mathbf|text)\s*\{([^{}]*)\}", r"\1", s)
    s = re.sub(r"\\[A-Za-z]+\s*", "", s)
    s = re.sub(r"[{}$]", "", s)
    return re.sub(r"\s+", " ", s).strip()


_PARTICLES = {"van", "von", "der", "de", "del", "della", "di", "da", "le", "la", "du", "dos", "ter", "den"}


def authors_to_ref(author: str) -> str:
    names = [n.strip() for n in re.split(r"\s+and\s+", clean_latex(author), flags=re.I) if n.strip()]
    out, etal = [], False
    for n in names:
        if n.lower() == "others":
            etal = True
            continue
        if "," in n:
            last, first = n.split(",", 1)
            last, first = last.strip(), first.strip()
        else:
            p = n.split()
            k = len(p) - 1
            while k > 0 and p[k - 1] in _PARTICLES:
                k -= 1
            last, first = " ".join(p[k:]), " ".join(p[:k])
        inits = []
        for w in first.split():
            parts = [re.sub(r"[^A-Za-z\u00C0-\u024F]", "", x) for x in w.split("-")]
            parts = [x for x in parts if x]
            if parts:
                inits.append("-".join(x[0].upper() + "." for x in parts))
        out.append(f"{last}, {' '.join(inits)}" if inits else last)
    if not out:
        return ""
    return ", ".join(out) + (", et al." if etal else "")


def _arxiv_id(f: dict) -> str | None:
    ep = f.get("eprint", "")
    ap = (f.get("archiveprefix") or f.get("eprinttype") or "").lower()
    m = re.search(r"(\d{4}\.\d{4,5}(?:v\d+)?|[a-z\-]+(?:\.[A-Z]{2})?/\d{7}(?:v\d+)?)", ep)
    if m and (ap == "arxiv" or re.match(r"\d{4}\.\d{4,5}", ep)):
        return m.group(1)
    for k in ("url", "journal", "note", "howpublished"):
        m = re.search(r"arxiv(?:\.org/(?:abs|pdf)/|[:\s]+)\s*(\d{4}\.\d{4,5}(?:v\d+)?)", f.get(k, ""), re.I)
        if m:
            return m.group(1)
    return None


def _doi(f: dict) -> str | None:
    for k in ("doi", "url"):
        m = re.search(r"(10\.\d{4,9}/[^\s\"<>{}]+)", f.get(k, ""))
        if m:
            return m.group(1).rstrip(".,;")
    return None


def entry_to_ref_line(e: dict) -> str:
    f = e.get("fields", {})
    parts = []
    au = authors_to_ref(f.get("author") or f.get("editor") or "")
    if au:
        parts.append(au.rstrip(".") + ".")
    title = re.sub(r"^\[|\]$", "", clean_latex(f.get("title", ""))).rstrip(".")
    if title:
        parts.append(title + ".")
    venue = clean_latex(f.get("journal") or f.get("booktitle") or f.get("howpublished") or f.get("publisher")
                        or f.get("institution") or f.get("school") or "")
    ym = re.search(r"\b(1[5-9]\d{2}|20\d{2})\b", f.get("year") or f.get("date") or "")
    year = ym.group(1) if ym else ""
    vy = ", ".join(x for x in ([venue] if year and year in venue else [venue, year]) if x)
    if vy:
        parts.append(vy + ".")
    doi, arx = _doi(f), _arxiv_id(f)
    if doi:
        parts.append("doi:" + doi)
    if arx and not (doi and arx.lower() in doi.lower()) and arx not in vy:
        parts.append("arXiv:" + arx)
    return re.sub(r"^[#\[]+", "", re.sub(r"\s+", " ", " ".join(parts))).strip()


def bib_to_draft(text: str) -> dict:
    entries, errors = parse_bibtex(text)
    seen, kept, skipped = set(), [], []
    for e in entries:
        if not re.fullmatch(r"[^\s\]\[;,@]+", e["key"]):
            skipped.append({"key": e["key"], "reason": "citation key has characters a marker cannot carry"})
            continue
        if e["key"] in seen:
            skipped.append({"key": e["key"], "reason": "duplicate key"})
            continue
        seen.add(e["key"])
        kept.append(e)
    body = "\n".join(f"BibTeX entry [@{e['key']}]." for e in kept)
    refs = "\n\n".join(f"[@{e['key']}] {entry_to_ref_line(e)}" for e in kept)
    draft = f"{body}\n\n## References\n\n{refs}\n" if kept else ""
    return {"draft": draft, "entries": kept, "errors": errors, "skipped": skipped}
