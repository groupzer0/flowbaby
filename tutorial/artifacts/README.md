# Cognee Graph Visualizations

This directory contains HTML visualizations of the knowledge graph generated during the Cognee walkthrough.

## Generated Files

The walkthrough script generates three timestamped HTML files:

1. **graph_initial_{timestamp}.html** - Initial knowledge graph after ingestion and cognify()
2. **graph_enhanced_{timestamp}.html** - Knowledge graph after memify() adds semantic connections
3. **graph_final_{timestamp}.html** - Final knowledge graph after all searches and feedback

## Naming Convention

Files use the format: `graph_{stage}_{timestamp}.html`

- `{stage}`: One of `initial`, `enhanced`, or `final`
- `{timestamp}`: Format `YYYYMMDD_HHMMSS` (single timestamp for all artifacts in one run)

## Viewing

Open any HTML file in your browser to view the interactive knowledge graph visualization:

```bash
# Example
firefox artifacts/graph_final_20240115_143022.html
```

## Git Tracking

- HTML files are ignored by git (except this README)
- Only `.gitkeep` and documentation are version-controlled
- Each run generates new timestamped files
