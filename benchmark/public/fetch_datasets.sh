#!/usr/bin/env bash
# Download the public labelled datasets used by run_public.mjs into ./data
# (not committed: each keeps its own licence; see README.md here).
set -euo pipefail
cd "$(dirname "$0")"; mkdir -p data/citetracer
# 1. Badalova & Mayr (2026), Zenodo 10.5281/zenodo.21457492 — CC BY 4.0
curl -fsSL -o data/badalova_mayr_2026.csv \
  https://zenodo.org/api/records/21457492/files/manual_reference_verification_dataset.csv/content
# 2. CiteMe Citation Verification Benchmark v1, Zenodo 10.5281/zenodo.21610297 — CC BY 4.0
curl -fsSL -o data/citeme-corpus-v1.jsonl \
  https://zenodo.org/api/records/21610297/files/corpus-v1.jsonl/content
# 3. CiteTracer "Hallucinated_Citation" (Li, Lin & Ma 2026), Hugging Face Afrostnova/Hallucinated_Citation — MIT
HF=https://huggingface.co/datasets/Afrostnova/Hallucinated_Citation/resolve/main
for f in R1 R2 R3 H1 H2 H3 H4 H5 H6; do curl -fsSL -o data/citetracer/$f.json "$HF/$f.json"; done
curl -fsSL -o data/citetracer/iclr2026_hallucinated_refs_structured.json \
  "$HF/iclr2026_hallucinated/hallucinated_refs_structured.json"
sha256sum data/badalova_mayr_2026.csv data/citeme-corpus-v1.jsonl data/citetracer/*.json > data/SHA256SUMS.txt
cat data/SHA256SUMS.txt
