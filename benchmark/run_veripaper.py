#!/usr/bin/env python3
"""Run the veripaper pipeline over benchmark/samples.json and score it.

Configuration: the pipeline exactly as shipped (veripaper/ package),
default no-key mode — no VERIPAPER_API_KEY is set for the run, matching
what a user without an LLM key gets. Labels are parsed from the
pipeline's own markdown report; nothing is re-judged by hand.

Pre-registered scoring rules (fixed before the run, see METHOD.md):
  real                    pass = base label CITED or ABSTRACT-SUPPORTED
                          (citation recognised as existing);
                          FABRICATED/UNVERIFIED on a real sample = false alarm
  fabricated (with id)    pass = base label FABRICATED
  fabricated (entry, no id) pass = base label UNVERIFIED (no checker can
                          prove fabrication without an identifier; flagged-
                          as-unverifiable is the honest positive outcome)
  chimeric                pass = label carries [CHIMERIC:author-mismatch]
  retracted               pass = label carries [RETRACTED]
  specific-not-in-abstract pass = label carries [SPECIFIC-NOT-IN-ABSTRACT]
                          or [POSSIBLE-MISATTRIBUTION]
  any category            base label RATE_LIMITED = inconclusive
                          (rate-limiting is not a verdict; counted separately)
"""
from __future__ import annotations

import json
import re
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from veripaper import pipeline  # noqa: E402

FINDING_RE = re.compile(r"^### \d+\. \[([A-Z_]+)\](.*)$", re.M)
NOTE_RE = re.compile(r"^- Note: (.*)$", re.M)


def score(sample: dict, base: str, label: str) -> str:
    cat = sample["category"]
    if base == "RATE_LIMITED":
        return "inconclusive-rate-limited"
    if cat == "real":
        if base in ("CITED", "ABSTRACT-SUPPORTED"):
            return "pass"
        return "false-alarm" if base in ("FABRICATED", "UNVERIFIED") else "miss"
    if cat == "fabricated":
        if sample["subtype"] == "fabricated-entry-no-id":
            return "pass" if base == "UNVERIFIED" else "miss"
        return "pass" if base == "FABRICATED" else "miss"
    if cat == "chimeric":
        return "pass" if "[CHIMERIC" in label else "miss"
    if cat == "retracted":
        return "pass" if "[RETRACTED]" in label else "miss"
    if cat == "specific-not-in-abstract":
        return ("pass" if ("[SPECIFIC-NOT-IN-ABSTRACT]" in label
                           or "[POSSIBLE-MISATTRIBUTION]" in label) else "miss")
    return "miss"


def main() -> None:
    doc = json.loads((Path(__file__).parent / "samples.json").read_text(encoding="utf-8"))
    results = []
    for s in doc["samples"]:
        with tempfile.TemporaryDirectory() as td:
            draft = Path(td) / "draft.md"
            report = Path(td) / "report.md"
            draft.write_text(s["draft"], encoding="utf-8")
            pipeline.run_ground(str(draft), str(report))
            text = report.read_text(encoding="utf-8")
        findings = FINDING_RE.findall(text)
        notes = NOTE_RE.findall(text)
        if len(findings) != 1:
            results.append({"id": s["id"], "category": s["category"],
                            "error": f"expected 1 finding, got {len(findings)}"})
            print(f"{s['id']}: ERROR findings={len(findings)}")
            continue
        base, rest = findings[0]
        label = (base + rest).strip()
        outcome = score(s, base, label)
        results.append({"id": s["id"], "category": s["category"],
                        "subtype": s["subtype"], "base_label": base,
                        "label": label, "note": notes[0] if notes else "",
                        "outcome": outcome})
        print(f"{s['id']}: {label} -> {outcome}")
        time.sleep(0.5)
    out = Path(__file__).parent / "results_veripaper.json"
    out.write_text(json.dumps({"tool": "veripaper (python pipeline, no-key default)",
                               "run_at": "2026-10-20", "results": results},
                              indent=2, ensure_ascii=False), encoding="utf-8")
    from collections import Counter
    print("\nby category/outcome:")
    for k, v in sorted(Counter((r["category"], r.get("outcome", "error"))
                               for r in results).items()):
        print(" ", k, v)


if __name__ == "__main__":
    main()
