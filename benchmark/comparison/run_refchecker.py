#!/usr/bin/env python3
"""Run refchecker (github.com/markrussinovich/refchecker, MIT) over the benchmark.

Configuration: the documented keyless path —
  refchecker-webui check --paper samples.bib --no-llm --check-retractions --json
No LLM provider (its hallucination deep-search needs a paid LLM key, so it is
NOT exercised; see COMPARISON.md), no Semantic Scholar key. Input is BibTeX
(../samples.bib), the tool's native deterministic-parser path.

First pass: the whole .bib in one run. Samples that come back inconclusive
(refchecker's own "Verification timed out") are retried one entry per run
after 90 s and 240 s pauses; every attempt is kept.

Usage: pip install "academic-refchecker[webui]" (or a clone: pip install -e ".[webui]")
       REFCHECKER_COMMIT=<sha> python3 run_refchecker.py
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import BENCH, RESULTS, RETRY_PAUSES, load_samples, now_iso, write_results  # noqa: E402
from run_citegate import bib_entries  # noqa: E402
from score import score_refchecker  # noqa: E402

CMD = ["refchecker-webui", "check", "--no-llm", "--check-retractions", "--json", "--paper"]


def run_check(bib_path: Path, raw_log: Path) -> dict:
    p = subprocess.run(CMD + [str(bib_path)], capture_output=True, text=True, timeout=3600)
    raw_log.write_text(p.stdout + "\n--- stderr ---\n" + p.stderr, encoding="utf-8")
    out = p.stdout
    i = out.find("\n{\n") if not out.startswith("{\n") else -1
    doc = json.loads(out[i + 1:] if i >= 0 else out)
    by_key = {}
    retr = {r["index"]: r for r in (doc.get("retractions") or {}).get("results", [])}
    for pos, ref in enumerate(doc.get("references", []), 1):
        orig = ref.get("original_reference") or {}
        key = orig.get("bibtex_key")
        idx = orig.get("index") or pos
        errs = ref.get("errors") or []
        warns = ref.get("warnings") or []
        details = [f"{e.get('error_type')}: {(e.get('error_details') or '').strip()}" for e in errs]
        details += [f"warning {w.get('error_type') or w.get('warning_type')}: "
                    f"{(w.get('error_details') or w.get('warning_details') or '').strip()}" for w in warns]
        by_key[key] = {"status": ref.get("status"),
                       "retraction": (retr.get(idx) or {}).get("status"),
                       "timed_out": any("timed out" in (e.get("error_details") or "").lower() for e in errs),
                       "details": details,
                       "matched_database": ref.get("matched_database")}
    return by_key


def main() -> None:
    samples = load_samples()
    bibs = bib_entries()
    version = subprocess.run(["pip", "show", "academic-refchecker"], capture_output=True,
                             text=True).stdout
    version = (re.search(r"^Version: (.+)$", version, re.M) or [None, "unknown"])[1]
    RESULTS.mkdir(exist_ok=True)
    raw_dir = RESULTS / "refchecker_raw"
    raw_dir.mkdir(exist_ok=True)

    def row(s, r):
        return {"id": s["id"], "category": s["category"], "subtype": s["subtype"],
                "verdict": f"{r['status']} (retraction: {r['retraction']})",
                "status": r["status"], "retraction": r["retraction"], "details": r["details"],
                "matched_database": r["matched_database"], "checked_at": now_iso(),
                "outcome": score_refchecker(s, r["status"], r["retraction"], r["timed_out"])}

    full = run_check(BENCH / "samples.bib", raw_dir / "pass0_full.log")
    results = {}
    for s in samples:
        r = full.get(s["id"])
        results[s["id"]] = row(s, r) if r else {
            "id": s["id"], "category": s["category"], "subtype": s["subtype"],
            "verdict": "missing from output", "outcome": "inconclusive", "checked_at": now_iso()}
        results[s["id"]]["attempts"] = [dict(results[s["id"]])]
        print(s["id"], results[s["id"]]["verdict"], "->", results[s["id"]]["outcome"])

    for rnd, pause in enumerate(RETRY_PAUSES, 1):
        pending = [s for s in samples if results[s["id"]]["outcome"] == "inconclusive"]
        if not pending:
            break
        print(f"-- retry round {rnd}: {len(pending)} inconclusive, pausing {pause}s")
        time.sleep(pause)
        for s in pending:
            with tempfile.TemporaryDirectory() as td:
                bib = Path(td) / f"{s['id']}.bib"
                bib.write_text(bibs[s["id"]], encoding="utf-8")
                got = run_check(bib, raw_dir / f"pass{rnd}_{s['id']}.log").get(s["id"])
            if not got:
                continue
            new = row(s, got)
            new["attempts"] = results[s["id"]]["attempts"] + [dict(new)]
            results[s["id"]] = new
            print(s["id"], new["verdict"], "->", new["outcome"])

    out = write_results("refchecker", {
        "tool": "refchecker (academic-refchecker)", "version": version,
        "commit": os.environ.get("REFCHECKER_COMMIT", "unknown"),
        "input": "samples.bib", "config": " ".join(CMD) + " <bib>  (no LLM, no S2 key)",
        "run_finished_at": now_iso()}, samples, results)
    print("wrote", out)


if __name__ == "__main__":
    main()
