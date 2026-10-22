"""CI gate for BibTeX files: ``python -m veripaper check refs.bib``.

Runs the existing pipeline (existence-level BibTeX mode: DOI / arXiv / title
lookups against free registries, no key) over one or more .bib files and
turns the labels into an exit code a CI job can act on.

Categories (one per finding; a finding can hit several):
  fabricated    FABRICATED — an identifier in the entry does not exist in its registry
  chimeric      [CHIMERIC:author-mismatch] — real title, none of the listed authors
  retracted     [RETRACTED] — the cited paper is retracted
  unverified    UNVERIFIED — no confident match in the free indexes (may still be real)
  rate_limited  RATE_LIMITED — not checked; never treated as a fabrication
  invalid_doi   INVALID_DOI — DOI format invalid (warning by default)

Default ``--fail-on fabricated,chimeric,retracted``: the job fails only on
evidence of a problem. ``unverified`` and ``rate_limited`` are reported as
warnings unless listed in --fail-on, because a real paper can be missing from
the free indexes and a rate limit proves nothing. This is a first-pass screen:
review every flag by hand before acting on it.
"""
from __future__ import annotations

import glob
import json
import os
import sys
from dataclasses import asdict

CATEGORIES = ("fabricated", "chimeric", "retracted", "unverified", "rate_limited", "invalid_doi")
DEFAULT_FAIL_ON = ("fabricated", "chimeric", "retracted")


def categorize(label: str) -> list[str]:
    base = label.split(" [")[0].split(" ")[0]
    cats = []
    if base == "FABRICATED":
        cats.append("fabricated")
    if "[CHIMERIC" in label:
        cats.append("chimeric")
    if "[RETRACTED]" in label:
        cats.append("retracted")
    if base == "UNVERIFIED":
        cats.append("unverified")
    if base == "RATE_LIMITED":
        cats.append("rate_limited")
    if base == "INVALID_DOI":
        cats.append("invalid_doi")
    return cats


def parse_fail_on(value: str | None) -> tuple[str, ...]:
    if value is None:
        return DEFAULT_FAIL_ON
    items = tuple(x.strip().lower().replace("-", "_") for x in value.split(",") if x.strip())
    if items in (("none",),):
        return ()
    bad = [x for x in items if x not in CATEGORIES]
    if bad:
        raise ValueError(f"unknown --fail-on categories: {', '.join(bad)} (known: {', '.join(CATEGORIES)}, none)")
    return items


def expand_paths(patterns: list[str]) -> list[str]:
    out: list[str] = []
    for p in patterns:
        hits = sorted(glob.glob(p, recursive=True)) if any(c in p for c in "*?[") else [p]
        for h in hits:
            if h not in out:
                out.append(h)
    return out


def _bib_key(claim: str) -> str:
    # bib-mode claims look like "@key — Title"
    return claim[1:].split(" — ")[0] if claim.startswith("@") else claim


def check_files(paths: list[str], evidence_fn=None) -> list[dict]:
    """One row per entry: file, key, label, categories, note."""
    if evidence_fn is None:
        from veripaper.pipeline import ground_evidence as evidence_fn
    rows: list[dict] = []
    for path in paths:
        if not path.lower().endswith((".bib", ".bibtex")):
            raise ValueError(f"{path}: not a .bib / .bibtex file")
        if not os.path.isfile(path):
            raise FileNotFoundError(path)
        _pairs, evidence = evidence_fn(path)
        for ev in evidence:
            d = asdict(ev)
            rows.append({"file": path, "key": _bib_key(d["claim"]), "title": d["claim"].split(" — ", 1)[-1],
                         "label": d["label"], "categories": categorize(d["label"]),
                         "doi": d["source_doi"], "note": d["note"]})
    return rows


def _gh_escape(s: str) -> str:
    return str(s).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def summarize(rows: list[dict], fail_on: tuple[str, ...]) -> dict:
    counts = {c: sum(1 for r in rows if c in r["categories"]) for c in CATEGORIES}
    failing = [r for r in rows if set(r["categories"]) & set(fail_on)]
    return {"entries": len(rows), "counts": counts, "fail_on": list(fail_on),
            "failing": len(failing), "ok": not failing}


def markdown_summary(rows: list[dict], summary: dict) -> str:
    lines = ["## veripaper citation check", "",
             f"{summary['entries']} BibTeX entries checked against free registries (no key). "
             "First-pass screen — review every flag by hand.", "",
             "| Category | Count | Fails the job |", "|---|---|---|"]
    for c in CATEGORIES:
        lines.append(f"| {c} | {summary['counts'][c]} | {'yes' if c in summary['fail_on'] else 'no (warning)'} |")
    flagged = [r for r in rows if r["categories"]]
    if flagged:
        lines += ["", "| File | Key | Label | Note |", "|---|---|---|---|"]
        for r in flagged:
            note = r["note"].replace("|", "\\|")[:200]
            lines.append(f"| `{r['file']}` | `{r['key']}` | {r['label']} | {note} |")
    lines += ["", "**Result: " + ("pass" if summary["ok"] else f"fail ({summary['failing']} entries)") + "**", ""]
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    import argparse
    ap = argparse.ArgumentParser(prog="python -m veripaper check",
                                 description="Check .bib files for fabricated, chimeric or retracted citations (CI gate).")
    ap.add_argument("files", nargs="+", help=".bib files or glob patterns (e.g. 'paper/**/*.bib')")
    ap.add_argument("--fail-on", default=None,
                    help="comma-separated categories that fail the run: " + ",".join(CATEGORIES)
                    + " or 'none' (default: " + ",".join(DEFAULT_FAIL_ON) + ")")
    ap.add_argument("--json", dest="json_out", help="write all rows + summary as JSON")
    ap.add_argument("--summary", help="append a markdown summary to this file (e.g. $GITHUB_STEP_SUMMARY)")
    args = ap.parse_args(argv)
    try:
        fail_on = parse_fail_on(args.fail_on)
        paths = expand_paths(args.files)
        if not paths:
            print("error: no .bib files matched", file=sys.stderr)
            return 2
        rows = check_files(paths)
    except (ValueError, FileNotFoundError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    summary = summarize(rows, fail_on)
    gha = os.environ.get("GITHUB_ACTIONS") == "true"
    for r in rows:
        if not r["categories"]:
            continue
        level = "error" if set(r["categories"]) & set(fail_on) else "warning"
        msg = f"{r['key']}: {r['label']} — {r['note']}"
        if gha:
            print(f"::{level} file={_gh_escape(r['file'])},title=veripaper {r['label'].split(' ')[0]}::{_gh_escape(msg)}")
        else:
            print(f"{level.upper()} {r['file']}: {msg}")
    c = summary["counts"]
    print(f"veripaper: {summary['entries']} entries · fabricated {c['fabricated']} · chimeric {c['chimeric']} · "
          f"retracted {c['retracted']} · unverified {c['unverified']} · rate-limited {c['rate_limited']} · invalid-DOI {c['invalid_doi']} → "
          + ("PASS" if summary["ok"] else f"FAIL ({summary['failing']} entries hit --fail-on {','.join(fail_on)})"))
    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump({"summary": summary, "rows": rows}, f, indent=2)
    if args.summary:
        with open(args.summary, "a", encoding="utf-8") as f:
            f.write(markdown_summary(rows, summary))
    return 0 if summary["ok"] else 1
