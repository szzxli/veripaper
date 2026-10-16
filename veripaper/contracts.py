"""ResearchContract: typed handoff object between pipeline phases.

Adopted from FAROS's PlanPackage concept: objectives, hypotheses, evidence
references and acceptance criteria travel as structured, validated data —
not raw natural language. Every phase consumes and produces contracts;
every review finding compiles into a structured Revision the researcher
must approve before the next round.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class EvidenceRef:
    """A single piece of evidence backing a claim."""
    claim: str
    source_doi: str | None = None
    label: str = "UNVERIFIED"  # VERIFIED | CITED | UNVERIFIED | STALE:YYYY | EXTRAPOLATED
    note: str = ""


@dataclass
class ResearchContract:
    """Cross-phase contract for one research thread."""
    topic: str
    research_questions: list[str] = field(default_factory=list)
    hypotheses: list[str] = field(default_factory=list)
    evidence: list[EvidenceRef] = field(default_factory=list)
    acceptance_criteria: list[str] = field(default_factory=list)
    target_venues: list[str] = field(default_factory=list)
    status: str = "draft"  # draft | validated | submitted | accepted
    # v2.0 collaboration layer
    authors: list[Author] = field(default_factory=list)
    contributions: list[Contribution] = field(default_factory=list)

    def validate(self) -> list[str]:
        """Return a list of problems; empty means the contract is well-formed."""
        problems = []
        if not self.research_questions:
            problems.append("no research questions defined")
        unverified = [e for e in self.evidence if e.label == "UNVERIFIED"]
        if unverified:
            problems.append(f"{len(unverified)} evidence ref(s) still UNVERIFIED")
        return problems


@dataclass
class Revision:
    """Compiled review finding → executable change, researcher-approved."""
    target_field: str
    old_value: str
    new_value: str
    rationale: str
    evidence: str = ""
    approved: bool = False


# CRediT taxonomy — the academic standard for contributor roles (14 roles).
CREDIT_ROLES = [
    "Conceptualization", "Data curation", "Formal analysis",
    "Funding acquisition", "Investigation", "Methodology",
    "Project administration", "Resources", "Software",
    "Supervision", "Validation", "Visualization",
    "Writing – original draft", "Writing – review & editing",
]


@dataclass
class Author:
    """A collaborator on the research contract (v2.0 collaboration layer)."""
    name: str
    email: str | None = None
    affiliation: str | None = None
    is_corresponding: bool = False
    roles: list[str] = field(default_factory=list)  # CRediT roles


@dataclass
class Contribution:
    """One ledger entry: who did what, on which target, when."""
    author: str
    action: str  # idea | experiment | writing | revision | rebuttal | review | ...
    target: str  # paper section or contract field
    timestamp: str = ""
    note: str = ""
