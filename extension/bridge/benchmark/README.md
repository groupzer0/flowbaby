# Flowbaby Benchmark Harness

**Version**: 1.1.0 (Plan 113 Evaluation Validity Hardening)  
**Prerequisites**: Plan 112 (Retrieval-First Benchmark Harness)

This document describes the benchmark harness for evaluating Flowbaby's retrieval quality. The harness runs **offline and deterministically** — no network calls or provider credentials required.

## Table of Contents

1. [How to Read the Scorecard](#how-to-read-the-scorecard)
2. [Multi-Positive Relevance (Filtered-Style)](#multi-positive-relevance-filtered-style)
3. [Macro vs Aggregate Metrics](#macro-vs-aggregate-metrics)
4. [Positives-Per-Query Distribution](#positives-per-query-distribution)
5. [Slice Reporting](#slice-reporting)
6. [Split Discipline (Leakage Prevention)](#split-discipline-leakage-prevention)
7. [Adding New Queries/Qrels](#adding-new-queriesqrels)
8. [Dataset Maintenance](#dataset-maintenance)
9. [Artifact Retention and Privacy](#artifact-retention-and-privacy)

---

## How to Read the Scorecard

The benchmark scorecard reports several key metrics:

### Primary Metrics

| Metric | What It Measures | Interpretation |
|--------|------------------|----------------|
| **nDCG@10** | Ranking quality in top 10 results | Higher is better (0–1). Accounts for position and graded relevance. |
| **Recall@10** | Coverage of relevant items in top 10 | Higher is better (0–1). What fraction of positives were retrieved? |
| **P@10** | Precision at rank 10 | Higher is better (0–1). What fraction of top 10 are relevant? |
| **RR** | Reciprocal Rank (MRR) | Higher is better (0–1). How early is the first relevant result? |

### Relevance Semantics

The scorecard header shows `relevance_semantics: filtered`, meaning:
- **Multiple correct answers are valid** per query
- Metrics reward retrieving *any* of the valid positives, not just one specific target
- This reflects open-world KG semantics where queries often have multiple valid supporting memories

### Report Sections

1. **Overall Metrics**: Aggregate scores across all queries
2. **Macro-Averaged Metrics**: Per-query equal weighting (see [Macro vs Aggregate](#macro-vs-aggregate-metrics))
3. **Label Shape Statistics**: Distribution of positives per query (see [Positives-Per-Query](#positives-per-query-distribution))
4. **Slice Breakdowns**: Performance by query category (see [Slice Reporting](#slice-reporting))

---

## Multi-Positive Relevance (Filtered-Style)

### What It Means

Traditional IR benchmarks often assume one correct answer per query. Flowbaby uses **filtered-style multi-positive** relevance:

- Each query can have **multiple valid relevant items** (qrels)
- Retrieval is scored on ability to find *any* of the valid positives
- This matches how knowledge graphs work — multiple memories can correctly answer a query

### Why It Matters

If your benchmark assumes single-answer semantics when multiple answers are valid:
- You'll **undercount success** when a valid alternative is retrieved
- You'll **overcount failure** when the system returns a correct but unlabeled answer

### In the Scorecard

```
relevance_semantics: filtered
```

This label confirms multi-positive qrels are being handled correctly. If you see metrics labeled "exact match," those would require retrieving a *specific* target (not used by default).

---

## Macro vs Aggregate Metrics

### The Problem: Hub Dominance

Aggregate metrics weight by qrel count (number of relevant items per query). This can be skewed by:
- **Hub queries**: Queries with many positives dominate the average
- **Popular content**: Frequently relevant items inflate scores
- **Imbalanced slices**: One query category drowns out others

### The Solution: Macro Averaging

**Macro-averaged metrics** give equal weight to each query:

```
macro_nDCG = mean(nDCG per query)  # Each query counts equally
aggregate_nDCG = weighted average by qrel count  # More qrels = more weight
```

### When to Use Which

| Use Case | Metric Type | Why |
|----------|-------------|-----|
| "How well do we serve the average user?" | Macro | Equal query weighting |
| "What's our overall retrieval volume quality?" | Aggregate | Reflects qrel-weighted distribution |
| "Are we serving all query types equally?" | Compare both | Large gaps indicate hub dominance |

### In the Scorecard

```markdown
## Macro-Averaged Metrics
| Metric | Macro Value |
|--------|-------------|
| nDCG@10 | 0.7234 |
| Recall@10 | 0.6500 |
```

Compare to "Overall Metrics" to detect hub dominance.

---

## Positives-Per-Query Distribution

### What It Shows

Label shape statistics reveal the distribution of relevant items across queries:

```markdown
## Label Shape Statistics
- Min positives: 1
- Max positives: 5  
- Mean positives: 2.4
- Median positives: 2
- P95 positives: 4
- Queries with 0 positives: 0.0%
- Queries with 1 positive: 25.0%
- Queries with 2+ positives: 75.0%
```

### Why It Matters

| Pattern | Implication | Action |
|---------|-------------|--------|
| High % of 0-positive queries | Many queries have no gold standard | Add qrels or remove unanswerable queries |
| High % of 1-positive queries | Approaching single-answer semantics | Consider if multi-positive is warranted |
| Very high max positives | Possible hub queries | Check for query quality issues |
| Large gap between mean and median | Skewed distribution | Consider macro metrics over aggregate |

### Zero-Positive Queries

Queries with zero positives are **intentionally retained** in the dataset:
- They contribute to false-positive tendency measurement
- High retrieval scores on 0-positive queries indicate precision problems
- Removing them would hide a real failure mode

---

## Slice Reporting

### What Slices Are

Slices are **named subsets** of queries for focused analysis:

| Slice | Purpose |
|-------|---------|
| `relationship-fidelity` | Queries requiring correct relationship extraction |
| `relationship-heavy` | Queries needing multiple relationships |
| `technical` | Technical/code-focused queries |
| `short-factual` | Simple fact retrieval |

### In the Scorecard

```markdown
## Slice: relationship-fidelity (3 queries)
| Metric | Score |
|--------|-------|
| nDCG@10 | 0.6800 |
```

The `(N queries)` count helps interpret reliability — small slices have higher variance.

### Using Slices for Diagnosis

1. **Compare slice vs overall**: Large gaps show category-specific problems
2. **Track across runs**: Regressions in specific slices guide debugging
3. **Balance coverage**: Ensure critical slices have sufficient queries

---

## Split Discipline (Leakage Prevention)

### The Problem: Test Data Leakage

If you tune parameters (thresholds, K values, weights) on test data:
- Your "test" scores are actually "validation" scores
- You lose the ability to get unbiased final metrics
- Improvements may be overfitting, not generalization

### The Solution: Enforced Splits

The dataset supports three splits:

| Split | Use For | NEVER Use For |
|-------|---------|---------------|
| `train` | Development, debugging | — |
| `validation` | Threshold tuning, K selection, early stopping | — |
| `test` | **Final evaluation only** | Selection, tuning, filtering |

### Enforcement

The harness **refuses** invalid workflows:

```python
from benchmark.benchmark_contract import validate_split_discipline

# ✅ Valid: tune on validation, evaluate on test
validate_split_discipline("validation", "test")

# ❌ Raises SplitDisciplineError
validate_split_discipline("test", "test")  # Cannot tune on test
```

### In Practice

1. Set `split` field in `topics.json` for each query
2. Filter to appropriate split when tuning
3. Final metrics come from `test` split only
4. Record which split was used in run provenance

---

## Adding New Queries/Qrels

### Pre-Submission Checklist

Before adding new benchmark content:

- [ ] **Query is answerable** from existing corpus
- [ ] **Multiple valid answers considered** — don't assume single-target
- [ ] **Split assigned** — new queries should start in train or validation
- [ ] **Slice tags added** — categorize for focused analysis
- [ ] **Canonical IDs used** — follow `benchmark_contract.py` ID generation rules

### Leakage Prevention Steps

1. **Never add to test split during active development**
   - New queries go to `train` or `validation`
   - Only move to `test` after tuning is frozen

2. **Don't look at test performance when judging qrels**
   - Label relevance based on query intent, not retrieval results
   - If you peek at what the system retrieves, you're biasing toward current behavior

3. **Document qrel decisions**
   - Use the `notes` field for non-obvious relevance calls
   - Future maintainers need to understand the judgment

### File Format Reference

**topics.json**:
```json
{
  "query_id": "q016",
  "query_text": "What is the authentication flow?",
  "slice_ids": ["technical", "factual-recall"],
  "split": "validation",
  "notes": "Tests basic auth understanding",
  "expected_positive_count": 3
}
```

**qrels.json**:
```json
{
  "query_id": "q016",
  "canonical_item_id": "auth-flow-memory-uuid",
  "relevance": 2
}
```

### Relevance Grades

| Grade | Meaning |
|-------|---------|
| 0 | Not relevant |
| 1 | Relevant |
| 2 | Highly relevant (primary/authoritative) |

---

## Dataset Maintenance

### Version Numbering

Dataset versions follow semver in `metadata.json`:

- **Major**: Breaking schema changes
- **Minor**: New queries/slices (backward compatible)
- **Patch**: Qrel corrections, notes updates

### Retention Policy

- **Run artifacts**: Keep last 20 runs (configurable)
- **Debug outputs**: Capped at 10MB per run
- **Test failures**: Retain for 30 days for debugging

### Health Checks

Periodically verify:

1. **No orphan qrels**: Every qrel references a valid topic
2. **No orphan topics**: Every topic has at least one qrel (or documented as 0-positive)
3. **Split balance**: Test split shouldn't grow unboundedly
4. **Slice coverage**: Critical slices have >= 3 queries

---

## Artifact Retention and Privacy

### IDs-Only Default

Benchmark outputs emit **canonical IDs and counts**, not raw content:

```
Query q001: 3 relevant retrieved, 2 relevant in corpus
```

### Optional Debug Mode

If detailed debugging is needed, opt-in explicitly. Debug output must:
- **Never include**: API keys, auth tokens, cookies, emails, usernames
- **Redact by default**: File paths (use relative paths or hashes)
- **Be temporary**: Auto-delete after investigation

### Safe Artifact Checklist

Before sharing benchmark outputs:
- [ ] No credentials or secrets
- [ ] No PII (emails, usernames)
- [ ] No absolute file paths
- [ ] Canonical IDs only (not raw memory text unless debugging)

---

## Quick Reference

### Running the Benchmark

```bash
# From extension/bridge/benchmark/
python benchmark_cli.py score \
  --dataset datasets/golden-v1 \
  --run runs/my-run.json \
  --output results.md
```

### Key Files

| File | Purpose |
|------|---------|
| `benchmark_contract.py` | Data schemas and validation |
| `benchmark_scorer.py` | Metric computation and reporting |
| `benchmark_cli.py` | Command-line interface |
| `datasets/golden-v1/` | Reference dataset |

### Metric Quick Guide

| If you want to know... | Look at... |
|------------------------|-----------|
| Overall ranking quality | `nDCG@10` (aggregate) |
| Per-user fairness | `nDCG@10` (macro) |
| Coverage completeness | `Recall@10` |
| First-result quality | `RR` (Mean Reciprocal Rank) |
| Label health | Label Shape Statistics |
| Category-specific issues | Slice breakdowns |
