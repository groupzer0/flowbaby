# Flowbaby Retrieval Benchmark Guide

This guide documents the benchmark harness for evaluating Flowbaby's retrieval quality.

## Overview

The benchmark system uses industry-standard IR evaluation tools (`ir_measures` + `pytrec_eval`) to measure retrieval quality with the following metrics:

| Metric | Description | Primary K |
|--------|-------------|-----------|
| **Recall@K** | Fraction of relevant items found in top K | K=5 |
| **Precision@K** | Fraction of top K items that are relevant | K=5 |
| **MRR** | Mean Reciprocal Rank of first relevant item | - |
| **MAP@K** | Mean Average Precision at K | K=5 |
| **nDCG@K** | Normalized Discounted Cumulative Gain | K=5 |

**Why K=5?** The chat/command surface shows the top-5 retrieved items to users, so K=5 is the primary evaluation point.

## Environment Setup

The benchmark harness runs from the **root `.venv`** (not the bridge runtime venv). This keeps dev/analysis tooling separate from extension runtime dependencies.

```bash
# Install benchmark dependencies (one time)
cd /path/to/flowbaby
source .venv/bin/activate
pip install -r requirements-dev.txt

# Run benchmarks from extension/bridge directory
cd extension/bridge
python -m pytest benchmark/ -v  # Run tests
python -m benchmark.benchmark_cli --help  # CLI usage
```

> **Note**: The bridge `.venv` (extension/bridge/.venv) is for runtime dependencies only. Benchmark tools are tracked in the root `requirements-dev.txt`.

## Quick Start

```bash
# Score a run against the golden dataset
cd extension/bridge
python -m benchmark.benchmark_cli score \
  --dataset benchmark/datasets/golden-v1 \
  --run path/to/run.json \
  --output results.json \
  --markdown results.md \
  --summary summary.json
```

## Dataset Format

Datasets are directories containing three files:

### `metadata.json`
```json
{
  "dataset_id": "flowbaby-golden-v1",
  "version": "1.0.0",
  "description": "Description of the dataset",
  "slice_definitions": {
    "technical": "Technical content queries",
    "chat-shaped": "Short Q/A style queries"
  },
  "canonicalization_version": "v1"
}
```

### `topics.json`
```json
[
  {
    "query_id": "q001",
    "query_text": "What is the architecture?",
    "slice_ids": ["technical", "multi-hop"],
    "notes": "Optional notes",
    "expected_positive_count": 3
  }
]
```

### `qrels.json`
Relevance judgments (human-reviewed):
```json
[
  {"query_id": "q001", "canonical_item_id": "doc1", "relevance": 2},
  {"query_id": "q001", "canonical_item_id": "doc2", "relevance": 1}
]
```

**Relevance scale:**
- `0` = Not relevant
- `1` = Relevant
- `2` = Highly relevant

## Run Format

A run file is the output of retrieval for scoring:

```json
{
  "run_id": "baseline-2025-01-18",
  "entries": [
    {"query_id": "q001", "canonical_item_id": "doc1", "rank": 1, "score": 0.95},
    {"query_id": "q001", "canonical_item_id": "doc2", "rank": 2, "score": 0.87}
  ]
}
```

## Canonical ID Rules (Step 0 Contract)

**Critical:** Item IDs must be stable across re-indexing for qrels to remain valid.

| Priority | Source | Method |
|----------|--------|--------|
| 1 | `topic_id` | Use directly (UUID) |
| 2 | `topic` | `uuid5(NAMESPACE_DNS, normalize(topic))` |
| 3 | `summary_text` | **NEVER USE** - Analysis 111 churn |

The `canonicalization_version` (currently `v1`) enables migration if rules change.

## Dataset Slices

The golden dataset covers these risk areas:

| Slice | Description | Coverage |
|-------|-------------|----------|
| `template-heavy` | Structure dominates content | 2 queries |
| `edge-sparse` | Minimal KG relationships | 2 queries |
| `technical` | Stack traces, code, errors | 4 queries |
| `chat-shaped` | Short Q/A inputs | 2 queries |
| `relationship-heavy` | Requires KG traversal | 4 queries |
| `no-context` | True negatives | 1 query |
| `short-factual` | Simple lookups | 3 queries |
| `multi-hop` | Compound queries | 3 queries |

## Interpreting Results

### Aggregate Metrics

The primary metrics to watch:

```
Recall@5: 0.85    # Are we finding the right items?
Precision@5: 0.70 # Are we returning noise?
MRR: 0.92         # Is the best item ranked first?
```

**Baseline targets (v0.7.4):**
- Recall@5 ≥ 0.7 (finding most relevant items)
- MRR ≥ 0.8 (first relevant item in top positions)

### Per-Slice Analysis

Compare metrics across slices to identify weak areas:

```
| Slice | Recall@5 | Precision@5 |
|-------|----------|-------------|
| technical | 0.90 | 0.75 |
| edge-sparse | 0.60 | 0.50 |  ← Area to improve
```

### Regression Detection

Compare `runSummary.json` files across versions:
- Same dataset version ensures comparable qrels
- `git_sha` tracks which code produced the run
- `duration_ms` helps identify performance regressions

## Adding New Topics

1. Add topic to `topics.json` with appropriate slice tags
2. Human-review and add qrels to `qrels.json`
3. Bump `version` in `metadata.json`
4. Run baseline to establish new metrics

## Exporting Runs from Flowbaby

Use the `run_exporter` module to convert retrieval results:

```python
from benchmark.run_exporter import export_retrieval_results_to_run

# results: Dict[query_id -> List[RetrievalResult]]
run = export_retrieval_results_to_run(results, run_id="my-run")
```

The exporter:
- Applies canonical ID rules
- Filters LLM-augmented content in benchmark mode
- Assigns ranks by score

## Artifacts

Each benchmark run produces:

1. **results.json** - Machine-readable metrics
2. **results.md** - Human-readable summary for PR review
3. **summary.json** - Run provenance for tracking

Example `summary.json`:
```json
{
  "run_id": "baseline-v0.7.4",
  "timestamp": "2025-01-18T12:00:00Z",
  "git_sha": "abc123",
  "dataset_id": "flowbaby-golden-v1",
  "dataset_version": "1.0.0",
  "canonicalization_version": "v1",
  "metrics": {"recall@5": 0.85, "precision@5": 0.70},
  "query_count": 12
}
```

## Dependencies

Benchmark-only dependencies (not required at runtime):
- `ir_measures` - Standard IR evaluation
- `pytrec-eval-terrier` - pytrec_eval backend

Install with:
```bash
pip install ir_measures pytrec-eval-terrier
```
