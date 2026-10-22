"""Phase 2 · Evidence grounding: paper markdown in, claim-by-claim verification report out.

Pipeline:
  draft.md → extract (claim, citation) pairs → existence check (CrossRef/DataCite/arXiv)
           → abstract fetch → LLM support judgment (BYOK; downgrade without key)
           → freshness check → report.md + list[EvidenceRef]

Honest-label rules (contracts.EvidenceRef):
  citation unresolvable/nonexistent → UNVERIFIED
  exists, LLM says supported       → ABSTRACT-SUPPORTED
  exists, uncertain/no abstract/no key → CITED (+ note; author decides)
  numeric claim with old timestamp  → STALE:YYYY tag appended
"""
from __future__ import annotations

from veripaper.contracts import EvidenceRef
from veripaper.verify import bibtex, citations, claims, extract, freshness, references


def _apply_tags(label: str, *groups: str) -> str:
    """Append bracket tags to ``label``, each tag at most once.

    Application is idempotent: a tag already present on ``label`` (or named
    again in a later group) is skipped. First-seen order is preserved, and
    the base label text is left unchanged. Callers that concatenate the same
    tag string twice therefore still emit each label once.
    """
    present = set(label.split())
    extra: list[str] = []
    for group in groups:
        for tag in (group or "").split():
            if tag in present:
                continue
            present.add(tag)
            extra.append(tag)
    if not extra:
        return label
    return f"{label} {' '.join(extra)}" if label else " ".join(extra)


def _verify_ids(doi: str | None, arxiv_id: str | None, via_note: str) -> dict:
    # fabricated: an explicit identifier checked against its registry and
    # positively NOT found — evidence of fabrication, never folded into
    # UNVERIFIED (which is absence of evidence).
    if doi:
        res = citations.verify_doi(doi)
        return {"exists": res["exists"], "title": res.get("title"),
                "doi": doi if res["exists"] else None, "arxiv_id": None,
                "limited": res.get("limited", False),
                "retracted": res.get("retracted", False),
                "authors": res.get("authors", []),
                "fabricated": (not res["exists"]) and (not res.get("limited", False)),
                "note": f"{via_note}; {res['reason']}"}
    if arxiv_id:
        res = citations.verify_arxiv(arxiv_id)
        return {"exists": res["exists"], "title": res.get("title"),
                "doi": f"10.48550/arXiv.{arxiv_id}" if res["exists"] else None,
                "arxiv_id": arxiv_id,
                "limited": res.get("limited", False),
                "retracted": res.get("retracted", False),
                "authors": res.get("authors", []),
                "fabricated": (not res["exists"]) and (not res.get("limited", False)),
                "note": f"{via_note}; {res['reason']}"}
    return {"exists": False, "title": None, "doi": None, "arxiv_id": None,
            "limited": False, "retracted": False, "authors": [],
            "fabricated": False, "note": via_note}


def _resolve(pair: dict, cache: dict, refmap: dict) -> dict:
    """Existence check for one extracted citation; results cached by (type, id)."""
    key = (pair["cite_type"], pair["cite_id"])
    if key in cache:
        return cache[key]
    t, cid = key
    if t == "doi":
        out = _verify_ids(cid, None, "raw DOI in text")
    elif t == "arxiv":
        out = _verify_ids(None, cid, "raw arXiv ID in text")
    elif t == "url" and "doi.org" in cid:
        doi = cid.split("doi.org/")[-1]
        out = _verify_ids(doi, None, "doi.org URL in text")
    elif t in ("numeric", "citekey", "author-year"):
        rm = references.resolve_marker(t, cid, refmap)
        if rm["doi"] or rm["arxiv_id"]:
            out = _verify_ids(rm["doi"], rm["arxiv_id"],
                              f"reference-list ({rm['via']}): {rm['note']}")
            out["chimeric"] = references.detect_chimeric(
                rm.get("entry_raw"), out.get("authors"))
        else:
            out = {"exists": False, "title": None, "doi": None, "arxiv_id": None,
                   "limited": bool(rm.get("limited")), "retracted": False,
                   "chimeric": False, "authors": [], "fabricated": False,
                   "note": f"reference-list: {rm['note']}"}
    else:
        out = {"exists": False, "title": None, "doi": None, "arxiv_id": None,
               "limited": False, "retracted": False, "chimeric": False,
               "authors": [], "fabricated": False,
               "note": f"marker type '{t}' is not resolvable"}
    cache[key] = out
    out.setdefault("chimeric", False)
    return out


def _read_draft(draft_path: str) -> str:
    """Read a draft from .md/.txt, .docx, or .pdf.

    .docx via python-docx, .pdf via pypdf — same local-extraction contract
    as the web client (nothing uploaded anywhere).
    """
    lp = draft_path.lower()
    if lp.endswith(".docx"):
        try:
            from docx import Document
        except ImportError:
            raise SystemExit("reading .docx needs python-docx: pip install python-docx")
        doc = Document(draft_path)
        return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())
    if lp.endswith(".pdf"):
        try:
            from pypdf import PdfReader
        except ImportError:
            raise SystemExit("reading .pdf needs pypdf: pip install pypdf")
        reader = PdfReader(draft_path)
        pages = [(page.extract_text() or "") for page in reader.pages[:60]]
        return "\n\n".join(pages)
    return open(draft_path, encoding="utf-8").read()


def run_ground(draft_path: str, out_path: str) -> str:
    """Run the full pipeline; write report markdown; return out_path.

    A .bib input is converted locally (verify/bibtex.py) into a reference
    list and checked entry by entry with the same lookups and labels —
    existence-level only (no claims, so no support judgment / freshness).
    """
    pairs, evidence = ground_evidence(draft_path)
    _write_report(out_path, draft_path, pairs, evidence)
    return out_path


def ground_evidence(draft_path: str) -> tuple[list[dict], list[EvidenceRef]]:
    """The pipeline without the report: (citation pairs, evidence rows)."""
    bib_mode = draft_path.lower().endswith((".bib", ".bibtex"))
    bib_titles: dict = {}
    if bib_mode:
        conv = bibtex.bib_to_draft(open(draft_path, encoding="utf-8").read())
        text = conv["draft"]
        bib_titles = {e["key"]: bibtex.clean_latex(e["fields"].get("title", "")) for e in conv["entries"]}
    else:
        text = _read_draft(draft_path)
    pairs = extract.extract_pairs(text)
    refmap = references.parse_references(text)

    cache: dict = {}
    evidence: list[EvidenceRef] = []

    for p in pairs:
        res = _resolve(p, cache, refmap)
        if bib_mode:
            key = p["cite_id"]
            p = dict(p, claim=f"@{key} — {bib_titles.get(key) or '(no title in entry)'}")
        fr = {"stale": False} if bib_mode else freshness.check_freshness(p["claim"])
        tags = [fr["tag"]] if fr["stale"] else []
        if res.get("chimeric"):
            tags.append("[CHIMERIC:author-mismatch]")
        if res.get("retracted"):
            tags.append("[RETRACTED]")
        tag_str = (" " + " ".join(tags)) if tags else ""

        if not res["exists"]:
            if res.get("limited"):
                # rate-limited is NOT not-found: say so explicitly
                evidence.append(EvidenceRef(
                    claim=p["claim"], source_doi=res["doi"],
                    label=_apply_tags("RATE_LIMITED", tag_str),
                    note=("source(s) rate-limited (HTTP 429) or unreachable while checking — "
                          "not checked, NOT proven fake. Try again later. " + res["note"])))
            elif res.get("fabricated"):
                evidence.append(EvidenceRef(
                    claim=p["claim"], source_doi=res["doi"],
                    label=_apply_tags("FABRICATED", tag_str),
                    note=("identifier checked against its registry and does not "
                          "exist — fabricated or mistyped; do not cite. "
                          + res["note"])))
            else:
                evidence.append(EvidenceRef(
                    claim=p["claim"], source_doi=res["doi"],
                    label=_apply_tags("UNVERIFIED", tag_str), note=res["note"]))
            continue

        if bib_mode:
            note = ("BibTeX entry: the record exists (" + res["note"] + "). "
                    "A .bib has no claims, so support is not judged.")
            if res.get("retracted"):
                note = "RETRACTED paper — do not cite it as support. " + note
            if res.get("chimeric"):
                note = ("CHIMERIC citation: the title matches a real paper but the "
                        "listed authors do not — " + note)
            evidence.append(EvidenceRef(claim=p["claim"], source_doi=res["doi"],
                                        label=_apply_tags("CITED", tag_str), note=note))
            continue

        abstract = claims.fetch_abstract(doi=res["doi"], arxiv_id=res["arxiv_id"])
        sup = claims.check_claim_support(p["claim"], abstract, res["title"] or "", doi=res["doi"])
        # Tags are attached before the retraction rewrite and again when the
        # evidence row is recorded. The second apply must not repeat a tag
        # already on the label.
        label = _apply_tags(
            "ABSTRACT-SUPPORTED" if sup["verdict"] == "verified" else "CITED",
            tag_str, sup.get("tag", ""))
        note = sup["reason"]
        if res.get("retracted"):
            if label == "ABSTRACT-SUPPORTED":
                label = "CITED"  # a retracted paper verifies nothing
            note = "RETRACTED paper — do not cite it as support. " + note
        if res.get("chimeric"):
            note = ("CHIMERIC citation: the title matches a real paper but the "
                    "listed authors do not — " + note)
        if abstract is None:
            note = "no abstract fetched; " + note
        evidence.append(EvidenceRef(
            claim=p["claim"], source_doi=res["doi"],
            label=_apply_tags(label, tag_str), note=note))

    return pairs, evidence


def _write_report(out_path: str, draft_path: str, pairs: list[dict],
                  evidence: list[EvidenceRef]) -> None:
    from collections import Counter
    counts = Counter(e.label.split(" ")[0] for e in evidence)
    lines = [
        "# Verification report",
        "",
        f"Source: `{draft_path}`",
        f"Claims checked: {len(evidence)} "
        f"({len(pairs)} citation markers extracted)",
        "",
        "## Summary",
        "",
    ]
    for label in ("ABSTRACT-SUPPORTED", "CITED", "UNVERIFIED", "RATE_LIMITED", "FABRICATED"):
        n = sum(v for k, v in counts.items() if k == label or k.startswith(label + ":"))
        # count STALE tags separately
        lines.append(f"- {label}: {n}")
    stale_n = sum(1 for e in evidence if "STALE:" in e.label)
    if stale_n:
        lines.append(f"- STALE tags: {stale_n}")
    chimeric_n = sum(1 for e in evidence if "[CHIMERIC" in e.label)
    if chimeric_n:
        lines.append(f"- CHIMERIC tags: {chimeric_n}")
    retracted_n = sum(1 for e in evidence if "[RETRACTED]" in e.label)
    if retracted_n:
        lines.append(f"- RETRACTED tags: {retracted_n}")
    lines += ["", "## Findings", ""]
    for i, e in enumerate(evidence, 1):
        base = e.label.split(" [")[0]
        tags = e.label[len(base):].strip()
        header = f"### {i}. [{base}]" + (f" {tags}" if tags else "")
        lines += [
            header,
            "",
            f"> {e.claim}",
            "",
            f"- Source DOI: {e.source_doi or '—'}",
            f"- Note: {e.note}",
            "",
        ]
    lines += [
        "---",
        "Labels: ABSTRACT-SUPPORTED = abstract substantively supports the claim (full text NOT checked); "
        "CITED = source exists but support is uncertain/unchecked (author decides); "
        "UNVERIFIED = no record found or marker not auto-resolvable "
        "(absence of evidence, not evidence of fabrication); "
        "FABRICATED = identifier checked against its registry and found not "
        "to exist — fabricated or mistyped; "
        "RATE_LIMITED = sources were rate-limited while checking — not checked, NOT proven fake; "
                "[STALE:YYYY] = numeric claim older than the freshness window; "
        "[CHIMERIC:author-mismatch] = title matches a real paper but the listed authors do not; "
        "[SPECIFIC-NOT-IN-ABSTRACT] = claim leans on hard specifics (numbers, quoted phrases) "
        "absent from the abstract — check the full text; "
        "[POSSIBLE-MISATTRIBUTION] = a missing specific appears in a paper this work cites — "
        "the finding may originate there; "
        "[RETRACTED] = the paper has been retracted — do not cite it as support.",
    ]
    open(out_path, "w", encoding="utf-8").write("\n".join(lines))
