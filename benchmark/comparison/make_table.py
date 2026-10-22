#!/usr/bin/env python3
"""Build the comparison tables from results/*.json (no numbers typed by hand).

Usage: python3 make_table.py [tool-result-name ...]   -> prints markdown
       python3 make_table.py --write [names ...]        -> rewrites the block between
         <!-- GENERATED:BEGIN --> and <!-- GENERATED:END --> in ../COMPARISON.md,
         and the 34-sample table between <!-- SAMPLES34:BEGIN --> and
         <!-- SAMPLES34:END --> in ../../web/index.html (from HOMEPAGE_RUN)
Default order: veripaper_after veripaper_web_before veripaper_web_after
veripaper_web_netfix refexists citegate refchecker (names without a results
file are skipped).
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from score import CATEGORIES  # noqa: E402

LABELS = {
    "veripaper_before": "veripaper (before fix)",
    "veripaper_after": "veripaper Python CLI, no key (+ retraction fix)",
    "veripaper": "veripaper",
    "veripaper_web_before": "veripaper web, no key (before: main @ b4bb41a)",
    "veripaper_web_after": "veripaper web, no key (after: fallbacks + keyless NLI)",
    "veripaper_web_netfix": "veripaper web, no key (re-run after the network-failure fix)",
    "refexists": "RefExists",
    "citegate": "citegate",
    "refchecker": "refchecker (no-LLM)",
}


# The homepage Accuracy block shows the latest web-app run.
HOMEPAGE_RUN = "veripaper_web_netfix"
# The re-run is compared verdict by verdict with the run before it.
RERUN_PAIR = ("veripaper_web_after", "veripaper_web_netfix")
HOMEPAGE_ROWS = [("real", "Real citations (should pass)"), ("fabricated", "Fabricated"),
                 ("chimeric", "Chimeric (real title, wrong authors)"), ("retracted", "Retracted"),
                 ("specific-not-in-abstract", "Specific not in abstract*")]


def la_date(iso):
    """Run date in America/Los_Angeles (result files carry UTC timestamps)."""
    import datetime as dt
    from zoneinfo import ZoneInfo
    t = dt.datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    return t.astimezone(ZoneInfo("America/Los_Angeles")).date().isoformat()


def homepage_block(doc):
    rows = doc["results"]
    tr = []
    for cat, label in HOMEPAGE_ROWS:
        c = Counter(r["outcome"] for r in rows if r["category"] == cat)
        n = sum(c.values())
        nc = f" ({c['inconclusive']} not checked)" if c["inconclusive"] else ""
        if cat == "real":
            cells = [f"{c['pass']}/{n} recognised{nc}", "—", str(c["false-alarm"])]
        else:
            cells = [f"{c['pass']}/{n}{nc}", str(c["miss"]), "—"]
        tr.append(f"        <tr><td>{label}</td><td>{n}</td><td>" + "</td><td>".join(cells) + "</td></tr>")
    return ("    <p class=\"hint\" style=\"margin:0 0 8px\"><b>Our labelled set: " + str(len(rows)) + " samples</b> — web app, "
            "no key, keyless check on (run " + la_date(doc["run_finished_at"]) + ").</p>\n"
            "    <div class=\"acc-wrap\"><table class=\"acc\">\n"
            "      <thead><tr><th>Category</th><th>n</th><th>Caught</th><th>Misses</th><th>False alarms</th></tr></thead>\n"
            "      <tbody>\n" + "\n".join(tr) + "\n      </tbody>\n    </table></div>\n")


def rerun_diff(docs):
    d = dict(docs)
    a, b = RERUN_PAIR
    if a not in d or b not in d:
        return []
    ia = {r["id"]: r for r in d[a]["results"]}
    changed = [(r["id"], ia[r["id"]].get("verdict"), r.get("verdict")) for r in d[b]["results"]
               if r["id"] in ia and (ia[r["id"]].get("verdict"), ia[r["id"]]["outcome"]) != (r.get("verdict"), r["outcome"])]
    out = ["", f"Re-run check — **{LABELS.get(b, b)}** vs. **{LABELS.get(a, a)}**: "
           + (f"{len(changed)} of {len(d[b]['results'])} per-sample verdicts changed." if changed
              else f"all {len(d[b]['results'])} per-sample verdicts identical.")]
    out += [f"- {i}: {x} → {y}".replace("|", "/") for i, x, y in changed]
    return out


def load(name):
    p = HERE / "results" / f"{name}.json"
    return json.loads(p.read_text()) if p.exists() else None


def cell(rows, cat):
    c = Counter(r["outcome"] for r in rows if r["category"] == cat)
    n = sum(c.values())
    if cat == "real":
        s = f"{c['pass']}/{n} recognised"
        extra = []
        if c["false-alarm"]:
            extra.append(f"**{c['false-alarm']} false alarm**")
        if c["metadata-flag"]:
            extra.append(f"{c['metadata-flag']} metadata flag")
        if c["inconclusive"]:
            extra.append(f"{c['inconclusive']} inconclusive")
        return s + (" · " + ", ".join(extra) if extra else "")
    if c["out-of-scope"] == n:
        return "out of scope"
    s = f"{c['pass']}/{n}"
    extra = []
    if c["miss"]:
        extra.append(f"{c['miss']} miss")
    if c["inconclusive"]:
        extra.append(f"{c['inconclusive']} inconclusive")
    return s + (" (" + ", ".join(extra) + ")" if extra else "")


def main():
    args = sys.argv[1:]
    write = "--write" in args
    args = [a for a in args if a != "--write"]
    names = args or ["veripaper_after", "veripaper_web_before", "veripaper_web_after",
                     "veripaper_web_netfix", "refexists", "citegate", "refchecker"]
    docs = [(n, load(n)) for n in names]
    docs = [(n, d) for n, d in docs if d]
    samples = json.loads((HERE.parent / "samples.json").read_text())["samples"]
    ncat = Counter(s["category"] for s in samples)
    out = ["| Category (n) | " + " | ".join(LABELS.get(n, n) for n, _ in docs) + " |",
           "|---|" + "---|" * len(docs)]
    for cat in CATEGORIES:
        out.append(f"| {cat} ({ncat[cat]}) | " + " | ".join(cell(d["results"], cat) for _, d in docs) + " |")
    out.append("")
    out.append("Per-sample outcomes (verdict → outcome):")
    out.append("")
    out.append("| Sample | " + " | ".join(LABELS.get(n, n) for n, _ in docs) + " |")
    out.append("|---|" + "---|" * len(docs))
    idx = [{r["id"]: r for r in d["results"]} for _, d in docs]
    for s in samples:
        cells = []
        for m in idx:
            r = m.get(s["id"])
            cells.append("—" if not r else f"{r.get('verdict')} → {r['outcome']}".replace("|", "/"))
        out.append(f"| {s['id']} | " + " | ".join(cells) + " |")
    out += rerun_diff(docs)
    out.append("")
    out.append("Run provenance:")
    out.append("")
    for n, d in docs:
        meta = {k: v for k, v in d.items() if k != "results"}
        out.append(f"- **{LABELS.get(n, n)}** — " + "; ".join(f"{k}: `{v}`" for k, v in meta.items()))
    text = "\n".join(out)
    if not write:
        print(text)
        return
    comp = HERE.parent / "COMPARISON.md"
    doc = comp.read_text(encoding="utf-8")
    a, b = "<!-- GENERATED:BEGIN -->", "<!-- GENERATED:END -->"
    i, j = doc.index(a) + len(a), doc.index(b)
    comp.write_text(doc[:i] + "\n" + text + "\n" + doc[j:], encoding="utf-8")
    print("updated", comp)
    home = dict(docs).get(HOMEPAGE_RUN)
    if home:
        page = HERE.parent.parent / "web" / "index.html"
        html = page.read_text(encoding="utf-8")
        a, b = "<!-- SAMPLES34:BEGIN -->", "<!-- SAMPLES34:END -->"
        i, j = html.index(a) + len(a), html.index(b)
        page.write_text(html[:i] + "\n" + homepage_block(home) + html[j:], encoding="utf-8")
        print("updated", page, "from", HOMEPAGE_RUN)


if __name__ == "__main__":
    main()
