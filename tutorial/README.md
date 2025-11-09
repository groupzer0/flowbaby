# Cognee Walkthrough Example

A complete implementation of the Cognee tutorial demonstrating knowledge graph construction, visualization, and interactive search capabilities for AI-powered coding assistants.

## Overview

This project demonstrates how to:
- Ingest structured developer context, conversations, and coding principles
- Build and visualize knowledge graphs with ontology support
- Execute context-aware searches across multiple data sources
- Apply interactive feedback for continuous learning
- Generate HTML visualizations at key stages

## Prerequisites

- **Python 3.8+** with pip package management
- **OpenAI API key** (note: free tier may be insufficient; estimated cost ~$0.01-0.05 per run with gpt-3.5-turbo)
- Approximately 50MB disk space for dependencies and artifacts

## Installation

1. Clone this repository:
   ```bash
   git clone <repository-url>
   cd cognee
   ```

2. Create and activate a virtual environment:
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Configure environment variables:
   ```bash
   cp .env.example .env
   # Edit .env and add your OpenAI API key
   ```

## Quick Start

Run the walkthrough script:
```bash
python examples/cognee_walkthrough.py
```

The script will:
1. Download sample data files (conversations, principles, ontology) from Cognee examples repository
2. Ingest data into Cognee nodesets
3. Build knowledge graph with ontology support
4. Generate three timestamped HTML visualizations (initial, enhanced, final)
5. Execute cross-document searches
6. Apply interactive feedback

## Project Structure

```
cognee/
├── examples/             # Walkthrough scripts
├── data/sample/          # Sample data files (auto-downloaded on first run)
├── artifacts/            # Generated HTML visualizations
├── utils/                # Helper functions
├── Planning/             # Implementation plans
└── .github/chatmodes/    # Custom chatmode definitions
```

## Expected Outputs

After successful execution, three timestamped HTML visualization files will be generated in `artifacts/`:
- `graph_initial_YYYYMMDD_HHMMSS.html` - Initial knowledge graph after cognify
- `graph_enhanced_YYYYMMDD_HHMMSS.html` - Enhanced graph after memify (semantic connections)
- `graph_final_YYYYMMDD_HHMMSS.html` - Final graph after interactive feedback

Open any HTML file in your browser for interactive exploration.

## Version Information

**Last tested with:** cognee 0.3.4

## Alternative LLM Provider Configuration

To use alternative LLM providers (e.g., Anthropic Claude, local models):

1. Set appropriate API keys in `.env`:
   ```env
   ANTHROPIC_API_KEY=your_anthropic_key_here
   # or
   OPENAI_BASE_URL=http://localhost:1234/v1  # for local models
   ```

2. Refer to [Cognee documentation](https://docs.cognee.ai) for provider-specific configuration details.

## Troubleshooting

### Rate Limits
- **Issue**: OpenAI API rate limit errors
- **Solution**: Ensure you have sufficient API quota; consider upgrading from free tier

### Import Errors
- **Issue**: `ModuleNotFoundError: No module named 'cognee'`
- **Solution**: Ensure virtual environment is activated and dependencies installed: `pip install -r requirements.txt`

### Missing Artifacts
- **Issue**: HTML visualization files not generated
- **Solution**: Check console output for errors; ensure `artifacts/` directory exists and is writable

### Network Failures
- **Issue**: Failed to download sample data files
- **Solution**: Check internet connectivity; files will be retried once then fail with clear error message

## Documentation

- [Official Cognee Documentation](https://docs.cognee.ai)
- [Cognee GitHub Repository](https://github.com/topoteretes/cognee)
- [Cognee Colab Notebook](https://colab.research.google.com/github/topoteretes/cognee/blob/main/notebooks/cognee_walkthrough.ipynb)
- [Cognee Discord Community](https://discord.gg/cognee)

## License

Sample data includes "Zen of Python" (PEP 20) content with appropriate PSF license attribution.
