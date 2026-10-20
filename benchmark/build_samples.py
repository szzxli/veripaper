#!/usr/bin/env python3
"""Build the public veripaper benchmark sample set (samples.json).

Every sample's ground truth is verified live at build time against the
public registries (Crossref / DataCite / arXiv / OpenAlex) using
veripaper's own lookup code plus OpenAlex's is_retracted flag as an
independent retraction source. Samples that fail verification are
reported and dropped (exit code 1 lists them) — never silently kept.

Construction methods per category (see METHOD.md):
  real        identifiers/entry metadata taken from the registry record itself
  fabricated  identifiers invented by the authors; kept only if the registry
              lookup definitively returns not-found (never on a 429)
  chimeric    a real paper's exact title paired with authors disjoint from
              the registry author list (checked with veripaper's own
              detect_chimeric against the live author list)
  retracted   works with OpenAlex is_retracted == true; whether Crossref
              also carries the "RETRACTED:" title prefix is recorded per
              sample (that prefix is the only signal veripaper reads)
  specific    real paper + a claim whose hard specifics (number / quoted
              phrase) are absent from the paper's abstract, verified with
              veripaper's own specifics_missing_from_abstract against the
              abstract fetched from the same sources the checker uses
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import requests  # noqa: E402

from veripaper.verify import citations, claims, references  # noqa: E402

UA = {"User-Agent": "veripaper-benchmark/1.0"}
CHECKED_AT = "2026-10-20"
SLEEP = 0.4

samples: list[dict] = []
problems: list[str] = []


def add(s: dict) -> None:
    samples.append(s)


def openalex_retracted(doi: str) -> bool | None:
    try:
        r = requests.get(f"https://api.openalex.org/works/https://doi.org/{doi}",
                         headers=UA, timeout=20)
        if r.status_code != 200:
            return None
        return bool(r.json().get("is_retracted"))
    except requests.RequestException:
        return None


# ---------------------------------------------------------------- real
REAL = [
    dict(id="real-01", subtype="doi-in-text",
         draft="Deep residual learning eases the training of substantially deeper networks and mitigates the degradation problem (10.1109/CVPR.2016.90).",
         ref="He, K., Zhang, X., Ren, S., & Sun, J. (2016). Deep residual learning for image recognition. Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition, 770-778. https://doi.org/10.1109/CVPR.2016.90",
         doi="10.1109/CVPR.2016.90"),
    dict(id="real-02", subtype="arxiv-in-text",
         draft="The Transformer dispenses with recurrence and convolutions and relies entirely on attention (arXiv:1706.03762).",
         ref="Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L., Gomez, A. N., Kaiser, L., & Polosukhin, I. (2017). Attention is all you need. Advances in Neural Information Processing Systems, 30. arXiv:1706.03762",
         arxiv="1706.03762"),
    dict(id="real-03", subtype="arxiv-in-text",
         draft="BERT pre-trains deep bidirectional representations from unlabeled text by jointly conditioning on both left and right context (arXiv:1810.04805).",
         ref="Devlin, J., Chang, M.-W., Lee, K., & Toutanova, K. (2019). BERT: Pre-training of deep bidirectional transformers for language understanding. Proceedings of NAACL-HLT 2019. arXiv:1810.04805",
         arxiv="1810.04805"),
    dict(id="real-04", subtype="reference-entry-with-doi",
         draft="Residual learning has become a standard building block for image recognition [1].\n\n## References\n[1] He, K., Zhang, X., Ren, S., & Sun, J. (2016). Deep residual learning for image recognition. CVPR. doi:10.1109/CVPR.2016.90",
         ref="[1] He, K., Zhang, X., Ren, S., & Sun, J. (2016). Deep residual learning for image recognition. CVPR. doi:10.1109/CVPR.2016.90",
         doi="10.1109/CVPR.2016.90"),
    dict(id="real-05", subtype="reference-entry-no-id",
         draft="Self-attention underpins most modern language models [1].\n\n## References\n[1] Vaswani, A., et al. Attention is all you need. NeurIPS 2017.",
         ref="[1] Vaswani, A., et al. Attention is all you need. NeurIPS 2017.",
         arxiv="1706.03762"),
    dict(id="real-06", subtype="doi-in-text",
         draft="The double-helix structure of DNA was described in a short Nature report (10.1038/171737a0).",
         ref="Watson, J. D., & Crick, F. H. C. (1953). Molecular structure of nucleic acids: A structure for deoxyribose nucleic acid. Nature, 171(4356), 737-738. https://doi.org/10.1038/171737a0",
         doi="10.1038/171737a0"),
    dict(id="real-07", subtype="arxiv-in-text",
         draft="LoRA freezes the pre-trained model weights and injects trainable low-rank decomposition matrices into each layer (arXiv:2106.09685).",
         ref="Hu, E. J., et al. (2022). LoRA: Low-rank adaptation of large language models. International Conference on Learning Representations. arXiv:2106.09685",
         arxiv="2106.09685"),
    dict(id="real-08", subtype="reference-entry-with-arxiv",
         draft="Diffusion models have beaten GANs on image synthesis benchmarks [1].\n\n## References\n[1] Ho, J., Jain, A., & Abbeel, P. (2020). Denoising diffusion probabilistic models. NeurIPS. arXiv:2006.11239",
         ref="[1] Ho, J., Jain, A., & Abbeel, P. (2020). Denoising diffusion probabilistic models. NeurIPS. arXiv:2006.11239",
         arxiv="2006.11239"),
]
for s in REAL:
    res = (citations.verify_doi(s["doi"]) if s.get("doi")
           else citations.verify_arxiv(s["arxiv"]))
    time.sleep(SLEEP)
    if not res["exists"] or res.get("limited"):
        problems.append(f"{s['id']}: real identifier did not verify ({res.get('reason')})")
        continue
    gt = {"registry_title": res.get("title"),
          "basis": "identifier resolves in its registry at build time"}
    add({"id": s["id"], "category": "real", "subtype": s["subtype"],
         "draft": s["draft"], "refexists_ref": s["ref"], "ground_truth": gt})

# ---------------------------------------------------------------- fabricated
FAB_IDS = [
    dict(id="fab-01", subtype="fabricated-doi",
         draft="Strain engineering has pushed perovskite solar-cell efficiency to a new record (10.1038/s41586-024-99999-9).",
         ref="Delacroix, M., et al. (2024). Record perovskite solar-cell efficiency via lattice strain engineering. Nature. https://doi.org/10.1038/s41586-024-99999-9",
         doi="10.1038/s41586-024-99999-9"),
    dict(id="fab-02", subtype="fabricated-doi",
         draft="New constraints on dark-matter candidates were presented in a recent report (10.1126/science.adq9999).",
         ref="Herrera, L., et al. (2025). New constraints on dark-matter candidates from underground detectors. Science. https://doi.org/10.1126/science.adq9999",
         doi="10.1126/science.adq9999"),
    dict(id="fab-03", subtype="fabricated-arxiv",
         draft="Sparse mixture-of-experts routing cuts inference cost substantially at scale (arXiv:2406.99999).",
         ref="Novak, P., et al. (2024). Sparse mixture-of-experts routing for low-cost inference at scale. arXiv:2406.99999",
         arxiv="2406.99999"),
    dict(id="fab-04", subtype="fabricated-doi",
         draft="The proposed detector tops the public benchmark leaderboard (10.1109/CVPR.2024.99999).",
         ref="Tanaka, Y., et al. (2024). A unified detector topping public vision benchmarks. Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition. https://doi.org/10.1109/CVPR.2024.99999",
         doi="10.1109/CVPR.2024.99999"),
    dict(id="fab-05", subtype="fabricated-arxiv",
         draft="Retrieval-augmented agents outperform fine-tuned baselines on long-horizon tasks (arXiv:2302.99998).",
         ref="Osei, D., et al. (2023). Retrieval-augmented agents for long-horizon task completion. arXiv:2302.99998",
         arxiv="2302.99998"),
]
for s in FAB_IDS:
    res = (citations.verify_doi(s["doi"]) if s.get("doi")
           else citations.verify_arxiv(s["arxiv"]))
    time.sleep(SLEEP)
    if res["exists"]:
        problems.append(f"{s['id']}: invented identifier unexpectedly EXISTS — dropped")
        continue
    if res.get("limited"):
        problems.append(f"{s['id']}: rate-limited at build time, cannot prove absence — dropped")
        continue
    gt = {"basis": "identifier invented by the benchmark authors; registry lookup "
                   f"at build time definitively returned not-found ({res.get('reason')})"}
    add({"id": s["id"], "category": "fabricated", "subtype": s["subtype"],
         "draft": s["draft"], "refexists_ref": s["ref"], "ground_truth": gt})

FAB_ENTRIES = [
    dict(id="fab-06", subtype="fabricated-entry-no-id",
         claim="Entanglement routing is a promising direction for metropolitan quantum networks [1].",
         entry="[1] Pemberton, R., et al. Quantum entanglement routing in metropolitan fiber networks. Nature Photonics 2023."),
    dict(id="fab-07", subtype="fabricated-entry-no-id",
         claim="Microvascular networks can restore mechanical function after damage [1].",
         entry="[1] Okafor, C., & Lindqvist, M. Self-healing polymer composites via microvascular networks. Science 2022."),
    dict(id="fab-08", subtype="fabricated-entry-no-id",
         claim="Geometry-aware video generation remains an open problem [1].",
         entry="[1] Zhang, W., et al. Hyperbolic diffusion transformers for few-shot video generation. NeurIPS 2024."),
]
for s in FAB_ENTRIES:
    draft = s["claim"] + "\n\n## References\n" + s["entry"]
    gt = {"basis": "reference entry (authors, title, venue, year) invented by the "
                   "benchmark authors; carries no identifier, so no checker can "
                   "prove fabrication — the honest positive outcome is "
                   "'unverifiable / not indexed'"}
    add({"id": s["id"], "category": "fabricated", "subtype": s["subtype"],
         "draft": draft, "refexists_ref": s["entry"], "ground_truth": gt})

# ---------------------------------------------------------------- chimeric
CHIMERIC = [
    dict(id="chim-01", true_arxiv="1706.03762",
         claim="Self-attention underpins most modern language models [1].",
         entry="[1] Smith, J., et al. Attention is all you need. NeurIPS 2017."),
    dict(id="chim-02", true_doi="10.1109/CVPR.2016.90",
         claim="Residual learning has become a standard building block for image recognition [1].",
         entry="[1] Garcia, M., et al. Deep residual learning for image recognition. CVPR 2016."),
    dict(id="chim-03", true_arxiv="1810.04805",
         claim="Bidirectional pre-training changed how language models are built [1].",
         entry="[1] Johnson, R., & Patel, S. BERT: Pre-training of deep bidirectional transformers for language understanding. NAACL 2019. arXiv:1810.04805"),
    dict(id="chim-04", true_doi="10.48550/arXiv.2006.11239",
         claim="Diffusion models have beaten GANs on image synthesis benchmarks [1].",
         entry="[1] Williams, T., et al. Denoising diffusion probabilistic models. NeurIPS 2020. doi:10.48550/arXiv.2006.11239"),
    dict(id="chim-05", true_arxiv="2005.14165",
         claim="Large language models are strikingly effective few-shot learners [1].",
         entry="[1] Nguyen, T., et al. Language models are few-shot learners. NeurIPS 2020."),
    dict(id="chim-06", true_arxiv="1412.6980",
         claim="Adaptive moment estimation remains a default optimizer choice [1].",
         entry="[1] Kim, S., et al. Adam: A method for stochastic optimization. ICLR 2015."),
]
for s in CHIMERIC:
    res = (citations.verify_doi(s["true_doi"]) if s.get("true_doi")
           else citations.verify_arxiv(s["true_arxiv"]))
    time.sleep(SLEEP)
    if not res["exists"]:
        problems.append(f"{s['id']}: underlying real paper did not verify")
        continue
    authors = res.get("authors") or []
    if not references.detect_chimeric(s["entry"], authors):
        problems.append(f"{s['id']}: entry is NOT chimeric by construction check "
                        f"(real authors: {authors})")
        continue
    draft = s["claim"] + "\n\n## References\n" + s["entry"]
    gt = {"registry_title": res.get("title"), "registry_authors": authors,
          "basis": "entry pairs the registry title verbatim with authors disjoint "
                   "from the registry author list (construction-checked with "
                   "veripaper's detect_chimeric against the live author list)"}
    add({"id": s["id"], "category": "chimeric", "subtype": "reference-entry",
         "draft": draft, "refexists_ref": s["entry"], "ground_truth": gt})

# ---------------------------------------------------------------- retracted
RETRACTED = [
    dict(id="retr-01", doi="10.1016/S0140-6736(97)11096-0",
         claim="An early report linked ileal-lymphoid-nodular hyperplasia with a developmental disorder in children (10.1016/S0140-6736(97)11096-0).",
         ref="Wakefield, A. J., et al. (1998). Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children. The Lancet, 351(9103), 637-641. https://doi.org/10.1016/S0140-6736(97)11096-0"),
    dict(id="retr-02", doi="10.1016/S0140-6736(20)31180-6",
         claim="A registry-based analysis reported on hydroxychloroquine treatment outcomes (10.1016/S0140-6736(20)31180-6).",
         ref="Mehra, M. R., et al. (2020). Hydroxychloroquine or chloroquine with or without a macrolide for treatment of COVID-19: a multinational registry analysis. The Lancet. https://doi.org/10.1016/S0140-6736(20)31180-6"),
    dict(id="retr-03", doi="10.1056/NEJMoa2007621",
         claim="A multinational registry analysis examined cardiovascular disease and drug therapy in hospitalised patients (10.1056/NEJMoa2007621).",
         ref="Mehra, M. R., et al. (2020). Cardiovascular disease, drug therapy, and mortality in Covid-19. New England Journal of Medicine. https://doi.org/10.1056/NEJMoa2007621"),
    dict(id="retr-04", doi="10.1038/nature12968",
         claim="Stimulus-triggered acquisition of pluripotency was reported in a widely discussed study (10.1038/nature12968).",
         ref="Obokata, H., et al. (2014). Stimulus-triggered fate conversion of somatic cells into pluripotency. Nature, 505, 641-647. https://doi.org/10.1038/nature12968"),
    dict(id="retr-05", doi="10.1038/nature12969",
         claim="A companion letter reported bidirectional developmental potential in reprogrammed cells (10.1038/nature12969).",
         ref="Obokata, H., et al. (2014). Bidirectional developmental potential in reprogrammed cells with acquired pluripotency. Nature, 505, 676-680. https://doi.org/10.1038/nature12969"),
    dict(id="retr-06", doi="10.1038/s41586-020-2801-z",
         claim="Room-temperature superconductivity was reported in a carbonaceous sulfur hydride system (10.1038/s41586-020-2801-z).",
         ref="Snider, E., et al. (2020). Room-temperature superconductivity in a carbonaceous sulfur hydride. Nature, 586, 373-377. https://doi.org/10.1038/s41586-020-2801-z"),
]
for s in RETRACTED:
    res = citations.verify_doi(s["doi"])
    time.sleep(SLEEP)
    oa = openalex_retracted(s["doi"])
    time.sleep(SLEEP)
    if not res["exists"]:
        problems.append(f"{s['id']}: retracted candidate does not resolve")
        continue
    if oa is not True:
        problems.append(f"{s['id']}: OpenAlex is_retracted is {oa}, not True — dropped")
        continue
    gt = {"registry_title": res.get("title"), "openalex_is_retracted": True,
          "crossref_title_prefix_signal": bool(res.get("retracted")),
          "basis": "OpenAlex marks the work retracted (is_retracted=true) at build "
                   "time; crossref_title_prefix_signal records whether Crossref "
                   "also prefixes the title with 'RETRACTED:' — the only "
                   "retraction signal veripaper's Crossref lookup reads"}
    add({"id": s["id"], "category": "retracted", "subtype": "doi-in-text",
         "draft": s["claim"], "refexists_ref": s["ref"], "ground_truth": gt})

# ---------------------------------------------------------------- specific
SPECIFIC = [
    dict(id="spec-01", arxiv="1810.04805",
         claim="Fine-tuned BERT reaches 98.7% accuracy on the CoLA benchmark (arXiv:1810.04805).",
         ref="Devlin, J., Chang, M.-W., Lee, K., & Toutanova, K. (2019). BERT: Pre-training of deep bidirectional transformers for language understanding. Proceedings of NAACL-HLT 2019. arXiv:1810.04805"),
    dict(id="spec-02", doi="10.1109/CVPR.2016.90",
         claim="A single ResNet-50 reaches 94.8% top-5 accuracy on ImageNet (10.1109/CVPR.2016.90).",
         ref="He, K., Zhang, X., Ren, S., & Sun, J. (2016). Deep residual learning for image recognition. Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition, 770-778. https://doi.org/10.1109/CVPR.2016.90"),
    dict(id="spec-03", arxiv="1706.03762",
         claim="The Transformer-big configuration reaches 99.1% accuracy on English constituency parsing (arXiv:1706.03762).",
         ref="Vaswani, A., et al. (2017). Attention is all you need. Advances in Neural Information Processing Systems, 30. arXiv:1706.03762"),
    dict(id="spec-04", arxiv="2006.11239",
         claim="Reducing DDPM sampling to 50 steps still yields an FID of 4.67 on CIFAR-10 (arXiv:2006.11239).",
         ref="Ho, J., Jain, A., & Abbeel, P. (2020). Denoising diffusion probabilistic models. Advances in Neural Information Processing Systems, 33. arXiv:2006.11239"),
    dict(id="spec-05", arxiv="2106.09685",
         claim="LoRA fine-tuning raises RoBERTa-base accuracy on MNLI to 91.7% (arXiv:2106.09685).",
         ref="Hu, E. J., et al. (2022). LoRA: Low-rank adaptation of large language models. International Conference on Learning Representations. arXiv:2106.09685"),
    dict(id="spec-06", arxiv="1406.2661",
         claim="The original GAN framework achieves 89.4% accuracy on MNIST classification (arXiv:1406.2661).",
         ref="Goodfellow, I., et al. (2014). Generative adversarial nets. Advances in Neural Information Processing Systems, 27. arXiv:1406.2661"),
]
for s in SPECIFIC:
    ab = claims.fetch_abstract(doi=s.get("doi"), arxiv_id=s.get("arxiv"))
    time.sleep(SLEEP)
    if not ab:
        problems.append(f"{s['id']}: no abstract fetched at build time — dropped")
        continue
    missing = claims.specifics_missing_from_abstract(s["claim"], ab)
    if not missing:
        problems.append(f"{s['id']}: claim specifics all present in abstract — dropped")
        continue
    gt = {"missing_specifics": missing,
          "basis": "the claim's hard specifics are absent from the cited work's "
                   "abstract, verified at build time with veripaper's own "
                   "specifics_missing_from_abstract against the abstract fetched "
                   "from the same public sources the checker queries"}
    add({"id": s["id"], "category": "specific-not-in-abstract",
         "subtype": "claim-specific-absent-from-abstract",
         "draft": s["claim"], "refexists_ref": s["ref"], "ground_truth": gt})

# ---------------------------------------------------------------- emit
out = Path(__file__).resolve().parent / "samples.json"
doc = {
    "name": "veripaper public citation-checking benchmark",
    "version": "1.0",
    "built_at": CHECKED_AT,
    "note": "Ground truth verified live at build time; see METHOD.md. "
            "Registry contents change over time — re-run build_samples.py "
            "to re-verify before quoting results.",
    "samples": samples,
}
out.write_text(json.dumps(doc, indent=2, ensure_ascii=False), encoding="utf-8")
from collections import Counter
print("samples by category:", dict(Counter(s["category"] for s in samples)))
print("total:", len(samples))
if problems:
    print("\nDROPPED / PROBLEMS:")
    for p in problems:
        print(" -", p)
    sys.exit(1)
print("all candidates verified")
