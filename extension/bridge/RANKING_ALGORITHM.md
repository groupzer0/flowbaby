# Ranking Algorithm for Cognee Chat Memory (Plan 018)

This document defines the **recency-aware ranking algorithm** used by `retrieve.py` to score and sort context retrieval results.

## Objective

Balance **semantic relevance** (how well the memory matches the query) with **temporal freshness** (how recent the information is) and **status** (whether it is an active decision or superseded history).

## Formula

The final relevance score is computed as:

$$
\text{Score} = S_{\text{semantic}} \times M_{\text{recency}} \times M_{\text{status}}
$$

Where:
- $S_{\text{semantic}}$: Semantic similarity score from Cognee (0.0 to 1.0)
- $M_{\text{recency}}$: Exponential time decay multiplier (0.0 to 1.0)
- $M_{\text{status}}$: Status-based weight multiplier

### 1. Semantic Similarity ($S_{\text{semantic}}$)

- **Source**: Cognee Hybrid Search (Graph + Vector)
- **Range**: 0.0 to 1.0 (typically)
- **Description**: Measures how closely the memory's content matches the user's query.

### 2. Recency Decay ($M_{\text{recency}}$)

We use an **exponential decay** function based on the age of the memory.

$$
M_{\text{recency}} = e^{-\alpha \times t}
$$

Where:
- $t$: Age of the memory in days (`(now - source_created_at) / 86400`)
- $\alpha$: Decay constant derived from the configured half-life

#### Half-Life Configuration

Users configure the **Half-Life** ($H$) in days via `cogneeMemory.ranking.halfLifeDays`. This is the time it takes for a memory's recency score to drop to 0.5 (50%).

The decay constant $\alpha$ is derived as:

$$
\alpha = \frac{\ln(2)}{H}
$$

**Defaults**:
- Default Half-Life ($H$): 7 days
- Default $\alpha \approx 0.099$

**Behavior**:
- $t=0$ days: $M_{\text{recency}} = 1.0$
- $t=7$ days: $M_{\text{recency}} = 0.5$
- $t=14$ days: $M_{\text{recency}} = 0.25$

### 3. Status Multiplier ($M_{\text{status}}$)

We apply a multiplier based on the memory's lifecycle status to prioritize authoritative decisions and deprioritize superseded history.

| Status | Multiplier | Rationale |
|--------|------------|-----------|
| `DecisionRecord` | **1.1x** | Compacted, authoritative decisions should rank highest. |
| `Active` | **1.0x** | Standard active memories. |
| `Superseded` | **0.4x** | Outdated information (only returned if explicitly requested). |
| `null` (Legacy) | **1.0x** | Treat legacy memories as Active. |

## Sorting Logic

Results are sorted by:
1. **Final Score** (Descending)
2. **Status Rank** (DecisionRecord > Active > Superseded) as a tie-breaker

## Implementation Details

- **Timestamp Source**: The algorithm prefers `source_created_at` (original creation time) over `created_at` (ingestion time) to preserve truthful recency during migrations.
- **Missing Timestamps**: If no timestamp is available, $t=0$ (no decay).
- **Configuration**: Passed from VS Code settings to `retrieve.py` via CLI arguments.

## Tuning

- **Increase Half-Life**: If users complain that relevant but older context is missing.
- **Decrease Half-Life**: If users complain about outdated information cluttering results.
