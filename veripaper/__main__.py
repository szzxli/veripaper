"""Command-line entry point: ``python -m veripaper ground draft.md --out report.md``."""
from __future__ import annotations

import argparse
import sys


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m veripaper",
                                 description="veripaper command-line tools")
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("ground", help="claim-by-claim citation verification report")
    g.add_argument("draft", help="paper draft: .md / .txt, .docx / .pdf, or a BibTeX .bib (every entry checked)")
    g.add_argument("--out", default="report.md", help="report path (default: report.md)")
    args = ap.parse_args(argv)

    if args.cmd == "ground":
        from veripaper.pipeline import run_ground
        try:
            out = run_ground(args.draft, args.out)
        except FileNotFoundError as e:
            print(f"error: {e}", file=sys.stderr)
            return 1
        print(f"report written: {out}")
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
