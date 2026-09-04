# Zera'ah Chat — Retrieval Evaluation

## Methodology

Retrieval-only evaluation (`npm run eval`, `server/eval.js`). Deterministic — no LLM calls.

- Query: embedding (Xenova/all-MiniLM-L6-v2, 384-dim) + hybrid search (dense cosine + Arabic BM25, blended by `alpha`).
- Metrics per alpha × topK grid (alpha ∈ {0.3, 0.5, 0.7, 1.0}, topK ∈ {3, 5, 10}):
  - **Recall@K / Precision@K / F1@K** — source-level (unique filenames), computed over in-domain retrieval questions.
  - **MRR@K** — reciprocal rank of first expected source.
  - **Source Hit Rate** — expected sources retrieved / total expected sources.
  - **Keyword match** — token-aware (shared Arabic tokenizer, exact tokens, no substring collisions).
- **Out-of-domain / adversarial** (expectedSources = []): rejection accuracy = fraction where top-1 dense score < 0.4 (the app's low-confidence threshold).
- **Citation validity**: not measurable in retrieval-only eval; enforced server-side (`utils/citations.js`) and covered by unit/integration tests (`test/citations.test.js`).

## Dataset

`data/eval_dataset.json` — 40 cases: 34 in-domain retrieval (incl. paraphrases, Arabic spelling variants, multi-source), 4 out-of-domain, 2 adversarial. `data/` is gitignored; this doc and result snapshots are the durable record.

## Results (best config by F1)

| Metric | Initial baseline (20q, old method, stale store) | New method baseline (40q, stale store) | Fresh seed | After Arabic normalization | Final |
|---|---|---|---|---|---|
| Recall@3 | 61.7% | 56.9% | 56.9% | **61.3%** | **61.3%** |
| Precision@3 | 34.2% | 34.8% | 34.8% | **35.8%** | **35.8%** |
| F1@3 | 44.0% | 43.2% | 43.2% | **45.2%** | **45.2%** |
| MRR@3 | — | 61.3% | 61.3% | **64.2%** | **64.2%** |
| Source Hit Rate@3 | — | 56.3% | 56.3% | **58.3%** | **58.3%** |
| Pass rate@3 | 75.0% | 70.6% | 70.6% | **76.5%** | **76.5%** |
| Recall@10 | 91.0% | 90.0% | 90.0% | **93.0%** | **93.0%** |
| Best alpha / topK | 0.3 / 3 | 0.3 / 3 | 0.3 / 3 | 0.3 / 3 | 0.3 / 3 |
| OOD rejection accuracy | — | 17% | 17% | 17% | 17% |
| OOD avg top-1 dense | — | 0.663 | 0.663 | 0.663 | 0.663 |

Notes:
- "Initial baseline" uses the old substring keyword matching and 20-question dataset; not directly comparable — reported for transparency.
- Fresh seed was **metric-identical** to the pre-seed store (the "stale store" finding was a UTF-8 byte-vs-char size bug, not content drift; store was rebuilt anyway and index sizes now match disk exactly).
- Arabic normalization improved all retrieval metrics at BM25-heavy configs; no regression observed → **kept**.
- OOD rejection is a known weakness: out-of-domain questions embed close to KB content (avg top-1 dense 0.663) — needs a product decision (see report).

## Snapshots

- `2026-09-04-initial-baseline.json` — old pipeline, 20 questions.
- `2026-09-04-methodology-stale-store.json` — new methodology, 40 questions, pre-seed store.
- `2026-09-04-fresh-seed.json` — after `npm run seed` (identical metrics).
- `2026-09-04-arabic-normalization.json` — after S14 normalization (improved).
- `2026-09-04-final.json` — final state.
