"""A network failure must never be reported as FABRICATED (Python pipeline).

Before: verify_doi() returned exists=False, limited=False when Crossref was
unreachable, so the pipeline labelled a real DOI FABRICATED — and the .bib CI
gate (`python -m veripaper check`) would fail a build on a network blip."""
from __future__ import annotations

import unittest
from unittest.mock import patch

from veripaper.verify import citations


class _R:
    def __init__(self, status):
        self.status_code = status
        self.headers = {}

    def json(self):
        return {}


class NetworkFailureTests(unittest.TestCase):
    def test_crossref_and_datacite_unreachable_is_not_checked(self):
        with patch.object(citations, "_get", return_value=None):
            res = citations.verify_doi("10.1109/CVPR.2016.90")
        self.assertFalse(res["exists"])
        self.assertTrue(res["limited"])
        self.assertIn("not checked", res["reason"])

    def test_crossref_unreachable_datacite_404_is_not_checked(self):
        seq = iter([None, _R(404)])
        with patch.object(citations, "_get", side_effect=lambda url: next(seq)):
            res = citations.verify_doi("10.1109/CVPR.2016.90")
        self.assertTrue(res["limited"])

    def test_both_registries_answer_404_is_still_fabricated_evidence(self):
        seq = iter([_R(404), _R(404)])
        with patch.object(citations, "_get", side_effect=lambda url: next(seq)):
            res = citations.verify_doi("10.9999/does-not-exist")
        self.assertFalse(res["exists"])
        self.assertFalse(res["limited"])

    def test_pipeline_labels_unreachable_rate_limited(self):
        import tempfile
        from pathlib import Path
        from veripaper.pipeline import ground_evidence
        with tempfile.TemporaryDirectory() as td:
            bib = Path(td) / "r.bib"
            bib.write_text("@article{a, title={T}, author={Doe, J.}, year={2020}, doi={10.1234/example}}\n", encoding="utf-8")
            with patch.object(citations, "_get", return_value=None):
                _pairs, ev = ground_evidence(str(bib))
        self.assertEqual(len(ev), 1)
        self.assertTrue(ev[0].label.startswith("RATE_LIMITED"), ev[0].label)


if __name__ == "__main__":
    unittest.main()
