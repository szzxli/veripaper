#!/usr/bin/env python3
"""Pre-registered scoring for the comparative benchmark (see ../COMPARISON.md).

Every tool's native verdict is mapped onto one shared outcome vocabulary:

  pass             the tool caught what the category asks it to catch
                   (on `real`: recognised as existing, nothing flagged)
  miss             it did not
  false-alarm      a real citation flagged as non-existent / unverifiable
  metadata-flag    a real citation found, but a metadata problem flagged
                   (counted separately from false alarms; see COMPARISON.md)
  inconclusive     the tool's own "not checked" state (rate limit, source
                   unreachable) — never counted as a pass or a miss
  out-of-scope     the category is outside the tool's stated scope

The mapping principle is the one METHOD.md fixed for RefExists on
2026-10-20, applied to each new tool's own vocabulary:
  - fabricated with identifier: pass = the tool's "not found" verdict
  - fabricated entry, no identifier: pass = "not found" / "unverifiable";
    a verdict that says a real work exists (even flagged for review) = miss
  - chimeric: pass = any flag that the entry does not match the record
  - retracted: pass = the tool's own retraction flag
  - specific-not-in-abstract: claim support; only veripaper claims it
"""
from __future__ import annotations

CATEGORIES = ["real", "fabricated", "chimeric", "retracted", "specific-not-in-abstract"]


def score_veripaper(sample: dict, base: str, label: str) -> str:
    cat = sample["category"]
    if base == "RATE_LIMITED":
        return "inconclusive"
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


def score_refexists(sample: dict, status: str, retracted) -> str:
    cat = sample["category"]
    if status == "error":
        return "inconclusive"
    if cat == "real":
        if status in ("verified", "likely"):
            return "pass"
        if status == "partial":
            return "metadata-flag"
        return "false-alarm"
    if cat == "fabricated":
        if sample["subtype"] == "fabricated-entry-no-id":
            return "pass" if status == "no_match" else "miss"
        return "pass" if status == "not_found" else "miss"
    if cat == "chimeric":
        return "pass" if status in ("mismatch", "partial") else "miss"
    if cat == "retracted":
        return "pass" if retracted is True else "miss"
    return "out-of-scope"


def score_citegate(sample: dict, verdict: str) -> str:
    """citegate verdicts: verified | not-found | retracted | mismatch | unverifiable | error."""
    cat = sample["category"]
    if verdict == "error":
        return "inconclusive"
    if cat == "real":
        if verdict == "verified":
            return "pass"
        if verdict == "mismatch":
            return "metadata-flag"
        return "false-alarm"  # not-found / unverifiable on a real work
    if cat == "fabricated":
        if sample["subtype"] == "fabricated-entry-no-id":
            return "pass" if verdict in ("not-found", "unverifiable") else "miss"
        return "pass" if verdict == "not-found" else "miss"
    if cat == "chimeric":
        return "pass" if verdict == "mismatch" else "miss"
    if cat == "retracted":
        return "pass" if verdict == "retracted" else "miss"
    return "out-of-scope"


def score_refchecker(sample: dict, status: str, retraction_status: str | None,
                     timed_out: bool) -> str:
    """refchecker per-reference status: verified | suggestion | warning | error |
    unverified (no-LLM mode; 'hallucination' needs an LLM and is not produced).
    retraction_status (--check-retractions, OpenAlex): retracted | clean |
    unknown | no_doi.
    refchecker maps a verification timeout onto `unverified` with the detail
    "Verification timed out" ("we couldn't verify"): that is its not-checked
    state, so it is inconclusive here, never a verdict."""
    cat = sample["category"]
    if status == "unverified" and timed_out:
        return "inconclusive"
    if cat == "real":
        if status in ("verified", "suggestion"):
            return "pass"
        if status in ("warning", "error"):
            return "metadata-flag"
        return "false-alarm"
    if cat == "fabricated":
        return "pass" if status == "unverified" else "miss"
    if cat == "chimeric":
        return "pass" if status in ("warning", "error") else "miss"
    if cat == "retracted":
        if retraction_status == "retracted":
            return "pass"
        if retraction_status == "unknown":
            return "inconclusive"
        return "miss"
    return "out-of-scope"
