#!/usr/bin/env python3
"""Score the public-dataset runs (results/*.jsonl from run_public.mjs).

Writes results/<run>.json (final verdict per item + summary) and, with
--write, regenerates the blocks between <!-- PUBLIC:BEGIN --> and
<!-- PUBLIC:END --> in ../COMPARISON.md and ../../web/index.html (the
site's Accuracy block). No number is typed by hand.

Outcome per item (run_public.mjs): flagged = FABRICATED / UNVERIFIED /
[CHIMERIC…] / [RETRACTED]; not_flagged = CITED; inconclusive =
RATE_LIMITED or a runner error, after the retry rounds.
  recall      = flagged problem items / problem items
  false alarm = flagged real items / real items
Both are given twice: inconclusive items left out (primary), and
inconclusive counted as flagged (the convention of the Badalova & Mayr
study, which standardised "unresolved / requires verification" as flagged).
95% intervals: Wilson score.
"""
from __future__ import annotations

import json
import math
import os
import sys
from collections import Counter, OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "results")
COMP = os.path.join(HERE, "..", "COMPARISON.md")

RUNS = OrderedDict([
    ("badalova", "veripaper_web_badalova"),
    ("citeme", "veripaper_web_citeme_per25"),
    ("citetracer", "veripaper_web_citetracer_per15"),
    ("iclr", "veripaper_web_iclr_per50"),
])
TOOLS = ["checkifexist", "hallucitechecker", "hallucinator", "halref", "refchecker"]
TOOL_NAMES = {"checkifexist": "CheckIfExist", "hallucitechecker": "HalluCiteChecker", "hallucinator": "Hallucinator",
              "halref": "HalRef", "refchecker": "RefChecker"}


def load(run):
    path = os.path.join(RES, run + ".jsonl")
    if not os.path.exists(path):
        return None, None
    last = OrderedDict()
    for line in open(path, encoding="utf-8"):
        if line.strip():
            r = json.loads(line)
            last[r["id"]] = r
    meta = json.load(open(os.path.join(RES, run + ".meta.json"), encoding="utf-8"))
    ids = meta["sampled_ids"]
    rows = [last[i] for i in ids if i in last]
    return rows, meta


def wilson(k, n, z=1.96):
    if not n:
        return None
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, c - h), min(1.0, c + h)


def pct(k, n):
    if not n:
        return "—"
    lo, hi = wilson(k, n)
    return f"{k}/{n} = {100 * k / n:.0f}% (95% CI {100 * lo:.0f}–{100 * hi:.0f}%)"


def rates(rows, truth):
    sel = [r for r in rows if r["truth"] == truth]
    c = Counter(r["outcome"] for r in sel)
    return len(sel), c["flagged"], c["not_flagged"], c["inconclusive"]


def strat_table(rows, label_head, order=None):
    by = OrderedDict()
    for r in sorted(rows, key=lambda r: (order.index(r["stratum"]) if order and r["stratum"] in order else 99, r["stratum"])):
        by.setdefault(r["stratum"], []).append(r)
    out = [f"| {label_head} | truth | n | flagged | not flagged | inconclusive |", "|---|---|---|---|---|---|"]
    for k, rs in by.items():
        c = Counter(r["outcome"] for r in rs)
        out.append(f"| {k} | {rs[0]['truth']} | {len(rs)} | {c['flagged']} | {c['not_flagged']} | {c['inconclusive']} |")
    return out


def headline(rows, has_ok=True):
    n_p, f_p, nf_p, i_p = rates(rows, "problem")
    lines = []
    lines.append(f"- **Recall on problem references** (inconclusive left out): {pct(f_p, f_p + nf_p)}; "
                 f"counting inconclusive as flagged: {pct(f_p + i_p, n_p)}")
    if has_ok:
        n_o, f_o, nf_o, i_o = rates(rows, "ok")
        lines.append(f"- **False-alarm rate on real references** (inconclusive left out): {pct(f_o, f_o + nf_o)}; "
                     f"counting inconclusive as flagged: {pct(f_o + i_o, n_o)}")
    inc = sum(1 for r in rows if r["outcome"] == "inconclusive")
    lines.append(f"- Inconclusive after retries (RATE_LIMITED / error): {inc} of {len(rows)}")
    return lines


def section(name, rows, meta):
    when = max((r.get("checked_at") or "") for r in rows) if rows else ""
    prov = (f"Run: `{meta['commit']}`, {meta['runtime']}; started {meta['started_at']}, last verdict {when} (UTC). "
            f"Sample: {meta['sample']} — {len(rows)} of {meta['population']} items scored. "
            f"Raw: `public/results/{RUNS[name]}.jsonl` (every attempt), sampled ids in `.meta.json`.")
    L = []
    if name == "badalova":
        L += ["### 1. Badalova & Mayr (2026) manual verification set — the July 2026 study's own data", "",
              "104 references from three documents (71 verified, 33 problematic: invented works, wrong DOI, "
              "title, authors, venue or year), labelled by hand; the five tools' outcomes are published in the "
              "same file. [Zenodo 10.5281/zenodo.21457492](https://doi.org/10.5281/zenodo.21457492), **CC BY 4.0**. "
              "veripaper received each `reference` string as a one-entry reference list (no claim), the same input "
              "the study gave tools that accept reference text.", ""]
        L += headline(rows)
        L += ["", "Same 104 references, the study's five tools (published outcomes from the dataset file, run by the "
              "study's authors in June–July 2026) next to veripaper (this run):", "",
              "| Tool | TP (problem flagged) | FN (problem missed) | FP (real flagged) | TN (real accepted) | recall | false-alarm rate |",
              "|---|---|---|---|---|---|---|"]
        n_p, f_p, nf_p, i_p = rates(rows, "problem")
        n_o, f_o, nf_o, i_o = rates(rows, "ok")
        L.append(f"| **veripaper web, no key** (inconclusive left out: {i_p} problem, {i_o} real) | {f_p} | {nf_p} | {f_o} | {nf_o} | "
                 f"{100 * f_p / max(1, f_p + nf_p):.0f}% | {100 * f_o / max(1, f_o + nf_o):.0f}% |")
        L.append(f"| veripaper web, no key (inconclusive counted as flagged) | {f_p + i_p} | {nf_p} | {f_o + i_o} | {nf_o} | "
                 f"{100 * (f_p + i_p) / max(1, n_p):.0f}% | {100 * (f_o + i_o) / max(1, n_o):.0f}% |")
        for t in TOOLS:
            tp = sum(1 for r in rows if r["truth"] == "problem" and r["published"][t] == "flagged")
            fn = sum(1 for r in rows if r["truth"] == "problem" and r["published"][t] != "flagged")
            fp = sum(1 for r in rows if r["truth"] == "ok" and r["published"][t] == "flagged")
            tn = sum(1 for r in rows if r["truth"] == "ok" and r["published"][t] != "flagged")
            L.append(f"| {TOOL_NAMES[t]} (published) | {tp} | {fn} | {fp} | {tn} | {100 * tp / max(1, tp + fn):.0f}% | {100 * fp / max(1, fp + tn):.0f}% |")
        miss = [r for r in rows if r["truth"] == "problem" and r["outcome"] == "not_flagged"]
        fa = [r for r in rows if r["truth"] == "ok" and r["outcome"] == "flagged"]
        L += ["", f"veripaper's misses ({len(miss)}): " + (", ".join(f"`{r['id']}`" for r in miss) or "none") + ".",
              f"veripaper's false alarms ({len(fa)}): " + (", ".join(f"`{r['id']}` ({r['verdict']})" for r in fa) or "none") + "."]
    elif name == "citeme":
        L += ["### 2. CiteMe Citation Verification Benchmark v1", "",
              "340 references built by construction (160 correct, 100 real works with exactly one corrupted field, "
              "80 fabricated), English / Portuguese / Spanish / German, five citation styles, some deliberately "
              "sloppy. [Zenodo 10.5281/zenodo.21610297](https://doi.org/10.5281/zenodo.21610297), **CC BY 4.0** "
              "(published by CiteMe, a commercial citation tool). Here `problem` = `FABRICATED`, `ok` = "
              "`EXISTS_CORRECT`; corrupted references are reported per corrupted field and are not in the two "
              "headline rates.", ""]
        L += headline(rows)
        L += [""] + strat_table(rows, "class : corrupted field")
    elif name == "citetracer":
        L += ["### 3. CiteTracer synthetic set (Li, Lin & Ma 2026)", "",
              "2,450 structured citations from real BibTeX seeds with controlled LLM mutations, 12 subtypes. "
              "[Hugging Face Afrostnova/Hallucinated_Citation](https://huggingface.co/datasets/Afrostnova/Hallucinated_Citation), "
              "**MIT**. Scored: R1–R3 (real: exact, format variant, et al.) and H1–H6 (title, author, venue, year, "
              "DOI, pages/volume error). The P1/P3 \"potential\" subtypes are ambiguous by the dataset's own "
              "definition and were not sampled. Each record was rendered as one BibTeX entry and checked through "
              "the site's .bib path (`bibToDraft`).", ""]
        L += headline(rows)
        recs = {}
        for st in ("R1", "R2", "R3"):
            fp = os.path.join(HERE, "data", "citetracer", st + ".json")
            if os.path.exists(fp):
                recs.update({r["citation_id"]: r for r in json.load(open(fp, encoding="utf-8"))})
        real = [recs[r["id"]] for r in rows if r["id"] in recs]
        if real:
            with_id = sum(1 for r in real if r.get("doi") or r.get("arxiv_id") or "doi.org/" in (r.get("url") or ""))
            L.append(f"- {with_id} of the {len(real)} sampled real records carry a DOI or arXiv ID, which makes "
                     "them easier to confirm than typical hand-written reference strings.")
        L += [""] + strat_table(rows, "subtype", ["R1", "R2", "R3", "H1", "H2", "H3", "H4", "H5", "H6"])
    elif name == "iclr":
        L += ["### 4. ICLR 2026 desk-rejected references (real-world fabrications)", "",
              "Reference strings that ICLR 2026 program chairs listed when desk-rejecting submissions for "
              "hallucinated references (\"do not refer to real documents and/or have major errors in "
              "bibliographic information\"), as collected in the same Hugging Face dataset (**MIT** as published "
              "there; the underlying text comes from OpenReview comments). All items are `problem`; there are no "
              "real references in this subset, so it gives recall only. Sampled from the "
              f"{meta['population']} references with a reference string in `hallucinated_refs_structured.json` "
              "(the dataset card says 957; we used the structured file as published).", ""]
        L += headline(rows, has_ok=False)
    L += ["", prov, ""]
    return L


def homepage_block(all_rows):
    """Compact HTML rows for the site's Accuracy block (web/index.html)."""
    names = {"badalova": "Badalova &amp; Mayr 2026 — the July 2026 study's data (CC BY 4.0)",
             "citeme": "CiteMe benchmark v1, sample (CC BY 4.0)",
             "citetracer": "CiteTracer synthetic set, sample (MIT)",
             "iclr": "ICLR 2026 desk-rejected references, sample (MIT)"}
    tr = []
    for name, rows in all_rows.items():
        n_p, f_p, nf_p, i_p = rates(rows, "problem")
        n_o, f_o, nf_o, i_o = rates(rows, "ok")
        rec = f"{f_p}/{f_p + nf_p}" if f_p + nf_p else "—"
        fa = f"{f_o}/{f_o + nf_o}" if f_o + nf_o else "—"
        inc = sum(1 for r in rows if r["outcome"] == "inconclusive" and r["truth"] in ("problem", "ok"))
        n_c = sum(1 for r in rows if r["truth"] == "corrupted")
        ncell = f"{n_p + n_o}" + (f" <span style=\"color:var(--ink-soft)\">(+{n_c} corrupted-field, in full results)</span>" if n_c else "")
        tr.append(f"        <tr><td>{names[name]}</td><td>{ncell}</td><td>{rec}</td><td>{fa}</td><td>{inc}</td></tr>")
    sent = ""
    if "badalova" in all_rows:
        rows = all_rows["badalova"]
        n_p, f_p, nf_p, _ = rates(rows, "problem")
        n_o, f_o, nf_o, _ = rates(rows, "ok")
        vr, vf = f_p / max(1, f_p + nf_p), f_o / max(1, f_o + nf_o)
        tr_r, tr_f = [], []
        for t in TOOLS:
            tp = sum(1 for r in rows if r["truth"] == "problem" and r["published"][t] == "flagged")
            fp = sum(1 for r in rows if r["truth"] == "ok" and r["published"][t] == "flagged")
            tr_r.append(tp / n_p); tr_f.append(fp / n_o)
        lower_fa = sum(1 for x in tr_f if vf < x)
        higher_rec = sum(1 for x in tr_r if x > vr)
        fa_txt = "any of the 5 tools" if lower_fa == len(TOOLS) else f"{lower_fa} of the 5 tools"
        sent = (f"On the July 2026 study's own data, veripaper raised fewer false alarms than {fa_txt} "
                f"tested there ({100 * vf:.0f}% vs. {100 * min(tr_f):.0f}–{100 * max(tr_f):.0f}%) but caught fewer problems "
                f"than {higher_rec} of them (recall {100 * vr:.0f}% vs. {100 * min(tr_r):.0f}–{100 * max(tr_r):.0f}%); it does "
                "not check venue, pages or partly wrong author lists. ")
    return ("    <p class=\"hint\" style=\"margin:14px 0 8px\"><b>Public third-party datasets</b> — existence / metadata level, "
            "same web pipeline, run 2026-10-21. Recall = problem references flagged; false alarms = real references flagged "
            "(not-checked items — rate-limited or unreachable — left out).</p>\n"
            "    <div class=\"acc-wrap\"><table class=\"acc\">\n"
            "      <thead><tr><th>Dataset (licence)</th><th>n</th><th>Recall</th><th>False alarms</th><th>Not checked</th></tr></thead>\n"
            "      <tbody>\n" + "\n".join(tr) + "\n      </tbody>\n    </table></div>\n"
            f"    <p class=\"hint\" style=\"margin-top:8px\">{sent}Web pages, software and standards have no scholarly record, so they "
            "count as false alarms here (<i>UNVERIFIED</i>).</p>\n")


def replace_block(path, text):
    s = open(path, encoding="utf-8").read()
    a, b = "<!-- PUBLIC:BEGIN -->", "<!-- PUBLIC:END -->"
    i, j = s.index(a) + len(a), s.index(b)
    open(path, "w", encoding="utf-8").write(s[:i] + "\n" + text + s[j:])


def main():
    write = "--write" in sys.argv
    blocks = []
    all_rows = OrderedDict()
    for name, run in RUNS.items():
        rows, meta = load(run)
        if rows is None:
            print("missing", run)
            continue
        summary = {k: dict(zip(["n", "flagged", "not_flagged", "inconclusive"], rates(rows, k))) for k in ("problem", "ok", "corrupted")}
        json.dump({"dataset": name, "meta": {k: v for k, v in meta.items() if k != "sampled_ids"}, "summary": summary,
                   "items": [{k: r.get(k) for k in ("id", "stratum", "truth", "verdict", "outcome", "checked_at")} for r in rows]},
                  open(os.path.join(RES, run + ".json"), "w", encoding="utf-8"), indent=1)
        blocks += section(name, rows, meta)
        all_rows[name] = rows
        print(name, json.dumps(summary))
    text = "\n".join(blocks).rstrip() + "\n"
    if write:
        replace_block(COMP, text)
        replace_block(os.path.join(HERE, "..", "..", "web", "index.html"), homepage_block(all_rows))
        print("updated COMPARISON.md and web/index.html")
    else:
        print(text)


if __name__ == "__main__":
    main()
