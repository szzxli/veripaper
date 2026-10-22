import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from veripaper import ci
from veripaper.pipeline import ground_evidence
from veripaper.verify import citations, extract


class InvalidDoiTests(unittest.TestCase):
    def test_find_invalid_dois(self):
        self.assertEqual(extract.find_invalid_dois("see 10.1/x."), ["10.1/x"])
        self.assertEqual(extract.find_invalid_dois("doi:10.12/ab and https://doi.org/10.99/zz"), ["10.12/ab", "10.99/zz"])
        self.assertEqual(extract.find_invalid_dois("valid 10.1234/example and doi:10.1109/CVPR.2016.90"), [])

    def _run(self, name, text):
        with tempfile.TemporaryDirectory() as td:
            f = Path(td) / name
            f.write_text(text, encoding="utf-8")
            with patch.object(citations, "_get", return_value=None):
                return ground_evidence(str(f))[1]

    def test_markdown_invalid_doi_labelled(self):
        ev = self._run("d.md", "Transformers beat RNNs (doi:10.1/x).\n\nAlso https://doi.org/10.22/bad shows it.\n")
        self.assertEqual([e.label for e in ev], ["INVALID_DOI", "INVALID_DOI"])
        self.assertIn("DOI format invalid", ev[0].note)

    def test_bib_invalid_doi_labelled(self):
        ev = self._run("r.bib", "@article{a, title={T}, author={Doe, J.}, year={2020}, doi={10.1/x}}\n")
        self.assertEqual(len(ev), 1)
        self.assertEqual(ev[0].label, "INVALID_DOI")

    def test_ci_warning_not_fail(self):
        self.assertEqual(ci.categorize("INVALID_DOI"), ["invalid_doi"])
        self.assertNotIn("invalid_doi", ci.DEFAULT_FAIL_ON)


if __name__ == "__main__":
    unittest.main()
