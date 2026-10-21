"""Shared helpers for the comparison runners: sample loading, retry rounds,
result files with tool version, run date and every attempt preserved."""
from __future__ import annotations

import datetime as _dt
import json
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
BENCH = HERE.parent
RESULTS = HERE / "results"
RETRY_PAUSES = (90, 240)  # seconds; same retry policy as METHOD.md


def load_samples() -> list[dict]:
    return json.loads((BENCH / "samples.json").read_text(encoding="utf-8"))["samples"]


def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat()


def run_with_retries(samples, check_one, is_inconclusive, log=print):
    """check_one(sample) -> dict with at least 'outcome'. Re-checks only
    inconclusive samples, after each pause in RETRY_PAUSES. Returns
    {id: final_result} with all attempts kept under 'attempts'."""
    results = {}
    pending = list(samples)
    for rnd, pause in enumerate((0,) + RETRY_PAUSES):
        if not pending:
            break
        if pause:
            log(f"-- retry round {rnd}: {len(pending)} inconclusive, pausing {pause}s")
            time.sleep(pause)
        nxt = []
        for s in pending:
            r = check_one(s)
            r["checked_at"] = now_iso()
            prev = results.get(s["id"])
            attempts = (prev["attempts"] if prev else []) + [dict(r)]
            r["attempts"] = attempts
            results[s["id"]] = r
            log(f"{s['id']}: {r.get('verdict')} -> {r['outcome']}")
            if is_inconclusive(r):
                nxt.append(s)
        pending = nxt
    return results


def write_results(name: str, meta: dict, samples, results: dict) -> Path:
    RESULTS.mkdir(exist_ok=True)
    out = RESULTS / f"{name}.json"
    rows = [results[s["id"]] for s in samples if s["id"] in results]
    for r in rows:
        if len(r.get("attempts", [])) == 1:
            r.pop("attempts")  # single attempt: nothing extra to keep
    out.write_text(json.dumps({**meta, "results": rows}, indent=2, ensure_ascii=False) + "\n",
                   encoding="utf-8")
    return out
