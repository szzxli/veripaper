#!/usr/bin/env python3
"""Run citegate (github.com/chrisyangsong/citegate, MIT) over the benchmark.

citegate's native input is BibTeX, so each sample is fed its entry from
../samples.bib (a transcription of the sample's `refexists_ref` string; rules
in that file's header). One single-entry .bib per sample, via the documented
CLI: `citegate <file.bib> --json <out>`. No API key exists or is needed.

Usage: pip install citegate==0.3.0 (or from a clone) && python3 run_citegate.py
Env:   CITEGATE_MAILTO (optional; passed as --mailto, Crossref polite pool)
       CITEGATE_COMMIT (optional; recorded in the results file)
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import BENCH, load_samples, now_iso, run_with_retries, write_results  # noqa: E402
from score import score_citegate  # noqa: E402


def bib_entries() -> dict[str, str]:
    text = (BENCH / "samples.bib").read_text(encoding="utf-8")
    out = {}
    for chunk in re.split(r"\n(?=@)", text):
        m = re.match(r"@\w+\{([\w-]+),", chunk.strip())
        if m:
            out[m.group(1)] = chunk.strip() + "\n"
    return out


def main() -> None:
    samples = load_samples()
    bibs = bib_entries()
    version = subprocess.run(["citegate", "--version"], capture_output=True, text=True).stdout.strip()
    mailto = os.environ.get("CITEGATE_MAILTO")

    def check_one(s):
        with tempfile.TemporaryDirectory() as td:
            bib = Path(td) / f"{s['id']}.bib"
            bib.write_text(bibs[s["id"]], encoding="utf-8")
            rep = Path(td) / "r.json"
            cmd = ["citegate", str(bib), "--json", str(rep), "--workers", "1"]
            if mailto:
                cmd += ["--mailto", mailto]
            subprocess.run(cmd, capture_output=True, text=True, timeout=600)
            if not rep.exists():
                return {"id": s["id"], "category": s["category"], "subtype": s["subtype"],
                        "verdict": "error", "problems": ["no report written"],
                        "outcome": "inconclusive"}
            r = json.loads(rep.read_text())["results"][0]
        return {"id": s["id"], "category": s["category"], "subtype": s["subtype"],
                "verdict": r["verdict"], "problems": r.get("problems", []),
                "matched_title": r.get("matched_title"), "matched_doi": r.get("matched_doi"),
                "similarity": r.get("similarity"),
                "outcome": score_citegate(s, r["verdict"])}

    results = run_with_retries(samples, check_one, lambda r: r["outcome"] == "inconclusive")
    out = write_results("citegate", {
        "tool": "citegate", "version": version,
        "commit": os.environ.get("CITEGATE_COMMIT", "unknown"),
        "input": "samples.bib (one entry per run)",
        "config": "defaults; --workers 1" + ("; --mailto set" if mailto else "; no --mailto"),
        "run_finished_at": now_iso()}, samples, results)
    print("wrote", out)


if __name__ == "__main__":
    main()
