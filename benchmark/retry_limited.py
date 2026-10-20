#!/usr/bin/env python3
"""Retry only the RATE_LIMITED (inconclusive) samples from
results_veripaper.json, after a pause. The pipeline's own label semantics
say rate-limited means 'not checked — try again later'; a retry is the
documented remedy, not score-shopping: every attempt is recorded in the
results file (attempts, first_label, final label)."""
from __future__ import annotations

import json
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from veripaper import pipeline  # noqa: E402
from run_veripaper import FINDING_RE, NOTE_RE, score  # noqa: E402

WAIT_SECONDS = int(sys.argv[1]) if len(sys.argv) > 1 else 90


def run_one(sample: dict) -> dict:
    with tempfile.TemporaryDirectory() as td:
        draft = Path(td) / "draft.md"
        report = Path(td) / "report.md"
        draft.write_text(sample["draft"], encoding="utf-8")
        pipeline.run_ground(str(draft), str(report))
        text = report.read_text(encoding="utf-8")
    findings = FINDING_RE.findall(text)
    notes = NOTE_RE.findall(text)
    base, rest = findings[0]
    label = (base + rest).strip()
    return {"base_label": base, "label": label,
            "note": notes[0] if notes else "",
            "outcome": score(sample, base, label)}


def main() -> None:
    bdir = Path(__file__).resolve().parent
    doc = json.loads((bdir / "samples.json").read_text(encoding="utf-8"))
    by_id = {s["id"]: s for s in doc["samples"]}
    res_doc = json.loads((bdir / "results_veripaper.json").read_text(encoding="utf-8"))
    targets = [r for r in res_doc["results"]
               if r.get("outcome") == "inconclusive-rate-limited"]
    print(f"retrying {len(targets)} samples after {WAIT_SECONDS}s pause")
    time.sleep(WAIT_SECONDS)
    for r in targets:
        s = by_id[r["id"]]
        new = run_one(s)
        r.setdefault("attempts", [{"label": r["label"], "outcome": r["outcome"]}])
        r["attempts"].append({"label": new["label"], "outcome": new["outcome"]})
        r["first_label"] = r["attempts"][0]["label"]
        r.update(new)
        print(f"{r['id']}: retry -> {new['label']} -> {new['outcome']}")
        time.sleep(2)
    (bdir / "results_veripaper.json").write_text(
        json.dumps(res_doc, indent=2, ensure_ascii=False), encoding="utf-8")
    from collections import Counter
    print("\nby category/outcome after retry:")
    for k, v in sorted(Counter((x["category"], x.get("outcome", "error"))
                               for x in res_doc["results"]).items()):
        print(" ", k, v)


if __name__ == "__main__":
    main()
