"""Collector: pull top-venue papers from OpenAlex.

Two-step: resolve venue name → OpenAlex source id, then page through works
filtered by source + year. Stores minimal fields for heat index / citation
prediction: id, doi, title, year, venue, cited_by_count, topics, authors.

Rate limits: OpenAlex throttles shared IPs (429). The fetcher backs off
exponentially; for bulk collection add ?mailto= or an API key (polite pool).

Usage:
    python -m veripaper.data.collect --venue NeurIPS --from-year 2021 --out data/neurips.jsonl
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.parse
import urllib.request

API = "https://api.openalex.org"
UA = {"User-Agent": "veripaper/0.1 (mailto:dev@veripaper.local)"}


def _get(url: str, params: dict | None = None, mailto: str | None = None) -> dict:
    q = dict(params or {})
    if mailto:
        q["mailto"] = mailto  # polite pool: higher rate limit
    qs = ("?" + urllib.parse.urlencode(q)) if q else ""
    req = urllib.request.Request(API + url + qs, headers=UA)
    # Exponential backoff: OpenAlex rate-limits shared IPs (429).
    # Tip: add ?mailto=you@example.com or an API key for the polite pool.
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 5:
                time.sleep(10 * (attempt + 1))
                continue
            raise
        except Exception:
            if attempt == 5:
                raise
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("unreachable")


def resolve_source(venue_name: str, mailto: str | None = None) -> dict | None:
    """Venue name → OpenAlex source {id, display_name} (best match)."""
    data = _get("/sources", {"search": venue_name, "per-page": 5}, mailto)
    results = data.get("results", [])
    return {"id": results[0]["id"], "display_name": results[0]["display_name"]} if results else None


def collect_venue(source_id: str, from_year: int, per_page: int = 200,
                  max_pages: int = 50, cursor: str = "*",
                  mailto: str | None = None):
    """Yield slim work dicts for one OpenAlex source."""
    filt = f"primary_location.source.id:{source_id},from_publication_date:{from_year}-01-01"
    params = {"filter": filt, "per-page": per_page, "cursor": cursor,
              "select": "id,doi,title,publication_year,primary_location,cited_by_count,topics,authorships"}
    pages = 0
    while pages < max_pages:
        data = _get("/works", params, mailto)
        for w in data.get("results", []):
            yield {
                "id": w["id"],
                "doi": w.get("doi"),
                "title": w.get("title"),
                "year": w.get("publication_year"),
                "venue": (w.get("primary_location") or {}).get("source", {}).get("display_name"),
                "cited_by_count": w.get("cited_by_count", 0),
                "topics": [t.get("display_name") for t in (w.get("topics") or [])[:5]],
                "authors": [a.get("author", {}).get("display_name")
                            for a in (w.get("authorships") or [])[:8]],
            }
        cursor = data.get("meta", {}).get("next_cursor")
        if not cursor:
            break
        params["cursor"] = cursor
        pages += 1
        time.sleep(0.2)  # be polite to the free API


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--venue", required=True, help="venue name, e.g. NeurIPS")
    ap.add_argument("--from-year", type=int, default=2021)
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-pages", type=int, default=50)
    ap.add_argument("--mailto", default=None, help="email for OpenAlex polite pool")
    args = ap.parse_args()

    src = resolve_source(args.venue, args.mailto)
    if not src:
        raise SystemExit(f"venue not found in OpenAlex: {args.venue}")
    print(f"resolved: {src['display_name']} ({src['id']})")

    n = 0
    with open(args.out, "w", encoding="utf-8") as f:
        for work in collect_venue(src["id"], args.from_year, max_pages=args.max_pages,
                                 mailto=args.mailto):
            f.write(json.dumps(work, ensure_ascii=False) + "\n")
            n += 1
    print(f"wrote {n} works → {args.out}")


if __name__ == "__main__":
    main()
