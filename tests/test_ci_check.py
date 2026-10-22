"""`python -m veripaper check` — the .bib CI gate (veripaper/ci.py).

No network: the registry lookups are mocked."""
from __future__ import annotations

import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path
from unittest.mock import patch

from veripaper import ci
from veripaper.__main__ import main as cli_main

BIB = r"""
@inproceedings{vaswani2017,
  title = {Attention is all you need},
  author = {Vaswani, Ashish and Shazeer, Noam},
  booktitle = {NeurIPS}, year = {2017},
  doi = {10.5555/real.1}
}
@article{fake2023,
  title = {A paper that does not exist},
  author = {Doe, Jane},
  journal = {Nowhere}, year = {2023},
  doi = {10.9999/fake.2}
}
@article{chimera2017,
  title = {Attention is all you need},
  author = {Smith, John and Jones, Mary},
  journal = {NeurIPS}, year = {2017},
  doi = {10.5555/real.3}
}
@article{retracted2020,
  title = {A retracted study},
  author = {Roe, Richard},
  journal = {J. Retractions}, year = {2020},
  doi = {10.5555/retr.4}
}
@article{limited2021,
  title = {Checked while rate-limited},
  author = {Poe, Edgar},
  journal = {J. Limits}, year = {2021},
  doi = {10.5555/lim.5}
}
"""

REAL = {"exists": True, "title": "Attention is all you need", "reason": "crossref match",
        "limited": False, "retracted": False, "authors": ["Ashish Vaswani", "Noam Shazeer"]}


def fake_verify_doi(doi: str) -> dict:
    if doi.startswith("10.9999/"):
        return {"exists": False, "title": None, "reason": "crossref 404", "limited": False}
    if doi == "10.5555/retr.4":
        return {"exists": True, "title": "RETRACTED: A retracted study", "reason": "crossref match",
                "limited": False, "retracted": True, "authors": ["Richard Roe"]}
    if doi == "10.5555/lim.5":
        return {"exists": False, "title": None, "reason": "HTTP 429", "limited": True}
    return dict(REAL)


class CheckGateTests(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.bib = Path(self.td.name) / "refs.bib"
        self.bib.write_text(BIB, encoding="utf-8")
        self.p = patch("veripaper.verify.citations.verify_doi", fake_verify_doi)
        self.p.start()

    def tearDown(self):
        self.p.stop()
        self.td.cleanup()

    def run_cli(self, *args, env=None):
        out, err = io.StringIO(), io.StringIO()
        with patch.dict(os.environ, env or {"GITHUB_ACTIONS": ""}), redirect_stdout(out), redirect_stderr(err):
            code = cli_main(["check", *args])
        return code, out.getvalue(), err.getvalue()

    def test_rows_are_categorised_per_entry(self):
        rows = {r["key"]: r for r in ci.check_files([str(self.bib)])}
        self.assertEqual(set(rows), {"vaswani2017", "fake2023", "chimera2017", "retracted2020", "limited2021"})
        self.assertEqual(rows["vaswani2017"]["categories"], [])
        self.assertEqual(rows["fake2023"]["categories"], ["fabricated"])
        self.assertEqual(rows["chimera2017"]["categories"], ["chimeric"])
        self.assertEqual(rows["retracted2020"]["categories"], ["retracted"])
        self.assertEqual(rows["limited2021"]["categories"], ["rate_limited"])

    def test_default_fails_on_evidence_but_not_on_rate_limit(self):
        code, out, _ = self.run_cli(str(self.bib))
        self.assertEqual(code, 1)
        self.assertIn("FAIL (3 entries", out)
        self.assertIn("WARNING", out)          # the rate-limited entry is only a warning
        self.assertIn("limited2021", out)

    def test_clean_file_passes(self):
        clean = Path(self.td.name) / "clean.bib"
        clean.write_text(BIB.split("@article{fake2023")[0], encoding="utf-8")
        code, out, _ = self.run_cli(str(clean))
        self.assertEqual(code, 0, out)
        self.assertIn("PASS", out)

    def test_fail_on_none_and_custom(self):
        self.assertEqual(self.run_cli(str(self.bib), "--fail-on", "none")[0], 0)
        self.assertEqual(self.run_cli(str(self.bib), "--fail-on", "rate-limited")[0], 1)
        code, _, err = self.run_cli(str(self.bib), "--fail-on", "bogus")
        self.assertEqual(code, 2)
        self.assertIn("unknown --fail-on", err)

    def test_github_annotations_json_and_summary(self):
        js = Path(self.td.name) / "out.json"
        md = Path(self.td.name) / "summary.md"
        code, out, _ = self.run_cli(str(self.bib), "--json", str(js), "--summary", str(md),
                                    env={"GITHUB_ACTIONS": "true"})
        self.assertEqual(code, 1)
        self.assertIn("::error file=", out)
        self.assertIn("::warning file=", out)
        data = json.loads(js.read_text())
        self.assertEqual(data["summary"]["entries"], 5)
        self.assertEqual(data["summary"]["counts"]["fabricated"], 1)
        summary = md.read_text()
        self.assertIn("First-pass screen", summary)
        self.assertIn("`fake2023`", summary)

    def test_glob_and_bad_inputs(self):
        code, out, _ = self.run_cli(str(Path(self.td.name) / "*.bib"), "--fail-on", "none")
        self.assertEqual(code, 0)
        self.assertIn("5 entries", out)
        self.assertEqual(self.run_cli(str(Path(self.td.name) / "nothing-*.bib"))[0], 2)
        self.assertEqual(self.run_cli(str(Path(self.td.name) / "missing.bib"))[0], 2)
        draft = Path(self.td.name) / "draft.md"
        draft.write_text("x", encoding="utf-8")
        self.assertEqual(self.run_cli(str(draft))[0], 2)

    def test_ground_subcommand_still_writes_a_report(self):
        rep = Path(self.td.name) / "report.md"
        out = io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(cli_main(["ground", str(self.bib), "--out", str(rep)]), 0)
        self.assertIn("# Verification report", rep.read_text())


if __name__ == "__main__":
    unittest.main()
