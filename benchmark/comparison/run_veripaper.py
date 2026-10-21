#!/usr/bin/env python3
"""Run veripaper (this repo's Python pipeline) over the benchmark.

Same configuration as ../run_veripaper.py: shipped pipeline, default no-key
mode (VERIPAPER_API_KEY unset), each sample's `draft` fed to
pipeline.run_ground, labels parsed from the pipeline's own report.

Usage: python3 run_veripaper.py [result-name]   (default: veripaper)
       e.g. `python3 run_veripaper.py veripaper_before` on the old code,
            `python3 run_veripaper.py veripaper_after` on the fixed code.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))
os.environ.pop("VERIPAPER_API_KEY", None)

from common import load_samples, now_iso, run_with_retries, write_results  # noqa: E402
from score import score_veripaper  # noqa: E402
from veripaper import pipeline  # noqa: E402

FINDING_RE = re.compile(r"^### \d+\. \[([A-Z_-]+)\](.*)$", re.M)


def dedup_tags(label: str) -> str:
    seen, out = set(), []
    for tok in re.findall(r"\[[^\]]+\]|[^\[\]]+", label):
        t = tok.strip()
        if not t or t in seen:
            continue
        seen.add(t)
        out.append(t)
    return " ".join(out)


def main() -> None:
    name = sys.argv[1] if len(sys.argv) > 1 else "veripaper"
    samples = load_samples()
    commit = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "HEAD"],
                            capture_output=True, text=True).stdout.strip()
    dirty = subprocess.run(["git", "-C", str(ROOT), "status", "--porcelain", "veripaper"],
                           capture_output=True, text=True).stdout.strip()

    def check_one(s):
        with tempfile.TemporaryDirectory() as td:
            draft, report = Path(td) / "draft.md", Path(td) / "report.md"
            draft.write_text(s["draft"], encoding="utf-8")
            pipeline.run_ground(str(draft), str(report))
            text = report.read_text(encoding="utf-8")
        time.sleep(0.5)
        f = FINDING_RE.findall(text)
        if len(f) != 1:
            return {"id": s["id"], "category": s["category"], "subtype": s["subtype"],
                    "verdict": f"error: {len(f)} findings", "outcome": "inconclusive"}
        base, rest = f[0]
        label = dedup_tags((f"[{base}]" + rest).strip()).replace(f"[{base}]", base, 1)
        return {"id": s["id"], "category": s["category"], "subtype": s["subtype"],
                "verdict": label, "base_label": base, "raw_label": (base + rest).strip(),
                "outcome": score_veripaper(s, base, label)}

    results = run_with_retries(samples, check_one, lambda r: r["outcome"] == "inconclusive")
    out = write_results(name, {
        "tool": "veripaper (python pipeline, no-key default)",
        "commit": commit + (" (+ uncommitted changes in veripaper/)" if dirty else ""),
        "input": "samples.json `draft`",
        "run_finished_at": now_iso()}, samples, results)
    print("wrote", out)


if __name__ == "__main__":
    main()
