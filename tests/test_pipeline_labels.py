"""Regression: citation tags are applied once.

Observed with a single citation in a minimal draft, default no-key mode:
the support-judgment path concatenated the tag string when the label was
built and again when the evidence row was recorded, so the report showed
``[CHIMERIC:author-mismatch] [CHIMERIC:author-mismatch]``.
"""
from __future__ import annotations

import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from veripaper.pipeline import _apply_tags, run_ground

MINIMAL_DRAFT = """# Draft

Prior work reports the result [1].

## References

[1] Smith, J. Attention is all you need. NeurIPS 2017. doi:10.5555/3295222.3295349.
"""

FINDING_RE = re.compile(r"^### \d+\. .+$", re.M)


def _verify_real_paper(doi: str) -> dict:
    return {
        "exists": True,
        "title": "Attention is all you need",
        "reason": "crossref match",
        "limited": False,
        "retracted": False,
        "authors": ["Ashish Vaswani", "Noam Shazeer"],
    }


class ApplyTagsTests(unittest.TestCase):
    def test_apply_is_idempotent_and_keeps_first_seen_order(self):
        groups = (
            " [STALE:2019] [CHIMERIC:author-mismatch] [RETRACTED]",
            " [SPECIFIC-NOT-IN-ABSTRACT]",
        )
        once = _apply_tags("CITED", *groups)
        twice = _apply_tags(once, *groups)
        self.assertEqual(
            once,
            "CITED [STALE:2019] [CHIMERIC:author-mismatch] "
            "[RETRACTED] [SPECIFIC-NOT-IN-ABSTRACT]",
        )
        self.assertEqual(twice, once)

    def test_empty_groups_leave_the_base_label_unchanged(self):
        for base in ("UNVERIFIED", "FABRICATED", "RATE_LIMITED", "ABSTRACT-SUPPORTED"):
            self.assertEqual(_apply_tags(base, "", "  "), base)


class ChimericLabelOnceTests(unittest.TestCase):
    def test_single_citation_no_key_draft_emits_each_tag_once(self):
        env = os.environ.copy()
        env.pop("VERIPAPER_API_KEY", None)
        with tempfile.TemporaryDirectory() as td:
            draft = Path(td) / "draft.md"
            report_path = Path(td) / "report.md"
            draft.write_text(MINIMAL_DRAFT, encoding="utf-8")
            with patch.dict(os.environ, env, clear=True), \
                 patch("veripaper.verify.citations.verify_doi", _verify_real_paper), \
                 patch("veripaper.pipeline.claims.fetch_abstract", return_value=None):
                run_ground(str(draft), str(report_path))
            report = report_path.read_text(encoding="utf-8")

        findings = FINDING_RE.findall(report)
        self.assertEqual(len(findings), 1, report)
        finding = findings[0]
        self.assertIn("[CITED]", finding)
        self.assertEqual(finding.count("[CHIMERIC:author-mismatch]"), 1, finding)
        self.assertNotIn("[CHIMERIC:author-mismatch] [CHIMERIC:author-mismatch]", report)
        self.assertIn("- CHIMERIC tags: 1", report)


if __name__ == "__main__":
    unittest.main()
