"""Phase 2 · Evidence grounding: paper markdown in, claim-by-claim verification report out.

Pipeline:
  draft.md → extract (claim, citation) pairs → existence check (CrossRef/DataCite/arXiv)
           → abstract fetch → LLM support judgment (BYOK; downgrade without key)
           → freshness check → report.md + list[EvidenceRef]

Honest-label rules (contracts.EvidenceRef):
  citation unresolvable/nonexistent → UNVERIFIED
  exists, LLM says supported       → VERIFIED
  exists, uncertain/no abstract/no key → CITED (+ note; author decides)
  numeric claim with old timestamp  → STALE:YYYY tag appended
"""
from __future__ import annotations

from veripaper.contracts import EvidenceRef
from veripaper.verify import citations, claims, extract, freshness


def _resolve(pair: dict, cache: dict) -> dict:
    """Existence check for one extracted citation; results cached by (type, id)."""
    key = (pair["cite_type"], pair["cite_id"])
    if key in cache:
        return cache[key]
    t, cid = key
    if t == "doi":
        res = citations.verify_doi(cid)
        out = {"exists": res["exists"], "title": res.get("title"),
               "doi": cid, "arxiv_id": None, "note": res["reason"]}
    elif t == "arxiv":
        res = citations.verify_arxiv(cid)
        out = {"exists": res["exists"], "title": res.get("title"),
               "doi": f"10.48550/arXiv.{cid}" if res["exists"] else None,
               "arxiv_id": cid, "note": res["reason"]}
    elif t == "url" and "doi.org" in cid:
        doi = cid.split("doi.org/")[-1]
        res = citations.verify_doi(doi)
        out = {"exists": res["exists"], "title": res.get("title"),
               "doi": doi, "arxiv_id": None, "note": res["reason"]}
    else:
        out = {"exists": False, "title": None, "doi": None, "arxiv_id": None,
               "note": (f"marker type '{t}' is not auto-resolvable "
                        "(citekey/numeric/author-year need the reference list); "
                        "match manually")}
    cache[key] = out
    return out


def run_ground(draft_path: str, out_path: str) -> str:
    """Run the full pipeline; write report markdown; return out_path."""
    text = open(draft_path, encoding="utf-8").read()
    pairs = extract.extract_pairs(text)

    cache: dict = {}
    evidence: list[EvidenceRef] = []

    for p in pairs:
        res = _resolve(p, cache)
        fr = freshness.check_freshness(p["claim"])
        stale_tag = ""
        if fr["stale"]:
            stale_tag = f" [{fr['tag']}]"

        if not res["exists"]:
            evidence.append(EvidenceRef(
                claim=p["claim"], source_doi=res["doi"],
                label="UNVERIFIED" + stale_tag, note=res["note"]))
            continue

        abstract = claims.fetch_abstract(doi=res["doi"], arxiv_id=res["arxiv_id"])
        sup = claims.check_claim_support(p["claim"], abstract, res["title"] or "")
        label = ("VERIFIED" if sup["verdict"] == "verified" else "CITED") + stale_tag
        note = sup["reason"]
        if abstract is None:
            note = "no abstract fetched; " + note
        evidence.append(EvidenceRef(
            claim=p["claim"], source_doi=res["doi"], label=label, note=note))

    _write_report(out_path, draft_path, pairs, evidence)
    return out_path


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
    for label in ("VERIFIED", "CITED", "UNVERIFIED"):
        n = sum(v for k, v in counts.items() if k == label or k.startswith(label + ":"))
        # count STALE tags separately
        lines.append(f"- {label}: {n}")
    stale_n = sum(1 for e in evidence if "STALE:" in e.label)
    if stale_n:
        lines.append(f"- STALE tags: {stale_n}")
    lines += ["", "## Findings", ""]
    for i, e in enumerate(evidence, 1):
        lines += [
            f"### {i}. [{e.label}]",
            "",
            f"> {e.claim}",
            "",
            f"- Source DOI: {e.source_doi or '—'}",
            f"- Note: {e.note}",
            "",
        ]
    lines += [
        "---",
        "Labels: VERIFIED = abstract substantively supports the claim; "
        "CITED = source exists but support is uncertain/unchecked (author decides); "
        "UNVERIFIED = no record found or marker not auto-resolvable; "
        "[STALE:YYYY] = numeric claim older than the freshness window.",
    ]
    open(out_path, "w", encoding="utf-8").write("\n".join(lines))
