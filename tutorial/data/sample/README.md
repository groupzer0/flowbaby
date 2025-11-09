# Sample Data Files

This directory contains sample data for the Cognee walkthrough demonstration.

## Files

### 1. developer_intro.txt
Developer profile text demonstrating single-document ingestion.

**Content**: Brief developer introduction mentioning technical skills (FastAPI, asyncio, cloud platforms).

### 2. human_agent_conversations.json
Sample conversation data for multi-turn dialogue ingestion.

**Source**: Downloaded from [cognee/examples/data](https://github.com/topoteretes/cognee/tree/main/examples/data)

**Structure**: JSON array of conversation objects with `role` and `content` fields.

### 3. python_zen_principles.md
The Zen of Python (PEP 20) principles in markdown format.

**Source**: Downloaded from [cognee/examples/data](https://github.com/topoteretes/cognee/tree/main/examples/data)

**License**: PSF License (Python Software Foundation)

### 4. ontology.json
Custom ontology defining entities and relationships for the knowledge graph.

**Source**: Downloaded from [cognee/examples/ontologies](https://github.com/topoteretes/cognee/tree/main/examples/ontologies)

**Structure**:
- `entities`: Array of entity definitions with `name` and `type`
- `relationships`: Array of relationship definitions with `source`, `target`, and `type`

## Automatic Download

Files 2-4 are automatically downloaded on first run by `utils/asset_helpers.py`.

To manually download or refresh:

```bash
python download_data.py
```

## Version Control

- `developer_intro.txt` is version-controlled (manually created)
- Downloaded files (2-4) are version-controlled locally after fetch
- Files are committed to ensure reproducible runs without network dependency
