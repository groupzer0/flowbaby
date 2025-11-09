# Implementation Plan: Cognee Walkthrough Example

**Plan ID**: 001  
**Created**: November 9, 2025  
**Status**: Draft  
**Source**: https://docs.cognee.ai/examples/getting-started-with-cognee

---

## Objective

Implement the complete Cognee Walkthrough tutorial as a functional Python project in this repository, enabling developers to:
1. Set up a Cognee-powered coding assistant environment
2. Ingest structured developer context, conversations, and principles
3. Build and visualize knowledge graphs with ontology support
4. Execute context-aware searches across multiple data sources
5. Apply interactive feedback for continuous learning
6. Generate HTML visualizations at key stages

---

## Assumptions

1. **Python Environment**: Python 3.8+ is available with pip package management
2. **API Keys**: User will provide their own OpenAI API key (or alternative LLM provider credentials)
3. **Dependencies**: The repository will include a `requirements.txt` with cognee==0.3.4; rely on cognee's dependency resolution for transitive dependencies
4. **Execution Context**: The walkthrough will be implemented as a standalone Python script (`examples/cognee_walkthrough.py`) for immediate execution and evaluation
5. **Data Assets**: Sample data files (conversations, principles) will be stored in `data/sample/`; ontology will be fetched initially from Cognee examples repo then versioned locally in git
6. **Artifacts Storage**: Generated visualizations will be saved to `artifacts/` using format `graph_{stage}_{timestamp}.html` where stage is "initial", "enhanced", or "final"
7. **Environment Configuration**: `.env.example` file will document required API keys; virtualenv is sufficient for development
8. **API Usage**: Expected ~15-20 OpenAI API calls per execution; OpenAI free tier may be insufficient due to rate limits
9. **No Database Preconfig**: Cognee will use default storage backend (can be configured later)

---

## Open Questions

**RESOLVED**: Rely on cognee's dependency resolution for transitive dependencies  
**RESOLVED**: Virtualenv is sufficient; no Docker support needed initially  
**RESOLVED**: Ontology file will be fetched from Cognee examples repo during first run, then committed to git for reproducibility  
**RESOLVED**: Artifact naming uses format `graph_{stage}_{timestamp}.html` where stage is "initial" (after cognify), "enhanced" (after memify), or "final" (after feedback); timestamp format is YYYYMMDD_HHMMSS  
**RESOLVED**: Include `.env.example` file for API key configuration  
**RESOLVED**: Sample data files (human_agent_conversations.json, python_zen_principles.md) will be committed to git in Milestone 2 for reproducibility

---

## Plan

### Milestone 1: Repository Structure and Dependencies

**Deliverables**:
- Project directory structure
- Python dependency manifest
- Environment configuration templates
- Basic documentation

**Steps**:

1. **Create directory structure**:

   ```text
   cognee/
   ├── .github/
   │   └── chatmodes/        (already exists)
   ├── Planning/             (already exists)
   ├── examples/
   │   ├── __init__.py
   │   └── cognee_walkthrough.py
   ├── data/
   │   └── sample/
   │       ├── developer_intro.txt
   │       ├── human_agent_conversations.json
   │       ├── python_zen_principles.md
   │       └── ontology.json
   ├── artifacts/
   │   └── .gitkeep
   ├── utils/
   │   ├── __init__.py
   │   └── asset_helpers.py
   ├── requirements.txt
   ├── .env.example
   ├── .gitignore
   └── README.md
   ```

2. **Create `requirements.txt`**:

   ```txt
   cognee==0.3.4
   python-dotenv>=1.0.0
   requests>=2.31.0
   ```

3. **Create `.env.example`**:

   ```env
   OPENAI_API_KEY=your_openai_api_key_here
   ONTOLOGY_FILE_PATH=data/sample/ontology.json
   ```

4. **Create `.gitignore`**:

   ```gitignore
   # Python
   __pycache__/
   *.py[cod]
   *$py.class
   .venv/
   venv/
   ENV/
   
   # Environment
   .env
   
   # Artifacts (timestamped outputs)
   artifacts/*.html
   artifacts/*.json
   artifacts/*.png
   !artifacts/.gitkeep
   !artifacts/README.md
   
   # Cognee data
   .cognee/
   ```

5. **Create `README.md`** with:
   - Project overview
   - Prerequisites (Python 3.8+, OpenAI API key)
   - Installation instructions (`pip install -r requirements.txt`)
   - Quick start guide referencing the walkthrough
   - Link to official Cognee documentation

**Acceptance Criteria**:

- All directories created and tracked in git
- `requirements.txt` includes cognee 0.3.4 with minimal dependencies
- `.env.example` documents required environment variables (OPENAI_API_KEY, ONTOLOGY_FILE_PATH)
- `.gitignore` prevents committing secrets and timestamped artifacts
- README provides clear setup instructions for virtualenv workflow

---

### Milestone 2: Data Asset Preparation

**Deliverables**:

- Sample data files in `data/sample/`
- Utility functions for asset management
- Data validation helpers

**Steps**:

1. **Create `data/sample/developer_intro.txt`**:

   ```text
   Hi, I'm an AI/Backend engineer. I build FastAPI services with Pydantic, heavy asyncio/aiohttp pipelines, and production testing via pytest-asyncio. I've shipped low-latency APIs on AWS, Azure, and GoogleCloud.
   ```

2. **Create `data/sample/human_agent_conversations.json`**:
   - Fetch from Cognee examples repository (https://github.com/topoteretes/cognee/tree/main/examples/data)
   - Structure: Array of conversation objects with `role` (values: "user" or "assistant"), `content` (string), and optional `timestamp` fields
   - Validate role values are constrained to "user" or "assistant"
   - Ensure chronological ordering if timestamps present
   - Commit to git after download for reproducibility

3. **Create `data/sample/python_zen_principles.md`**:
   - Copy the "Zen of Python" principles (PEP 20) from Python documentation
   - Format as markdown with headings and explanations
   - Include PSF license attribution comment at top of file
   - Commit to git after creation

4. **Create `data/sample/ontology.json`**:
   - Fetch from Cognee examples repository (https://github.com/topoteretes/cognee/tree/main/examples/ontologies)
   - Validate structure contains required keys: `entities` array (each with `name` and `type` fields) and `relationships` array (each with `source`, `target`, and `type` fields)
   - Commit to git after download and validation for reproducibility

5. **Create `utils/asset_helpers.py`** with three helper functions:
   - `create_notebook_artifacts_directory()`: Creates `artifacts/` directory if it doesn't exist, returns Path object
   - `download_remote_assets(force_download=False)`: Downloads sample data files (human_agent_conversations.json, python_zen_principles.md, ontology.json) from Cognee GitHub repo using requests library, skips if files already exist locally unless force_download=True, returns dictionary mapping asset names to file paths
   - `preview_downloaded_assets(asset_paths)`: Prints structure and size information for each downloaded file with first 200 characters preview

**Acceptance Criteria**:

- `developer_intro.txt` created with specified developer profile
- `utils/asset_helpers.py` can download missing files from Cognee repo
- Downloaded files are validated (valid JSON/markdown format)
- `human_agent_conversations.json` is valid JSON with conversation structure (role values constrained to "user"/"assistant") and committed to git
- `python_zen_principles.md` contains Zen of Python principles with PSF license attribution and committed to git
- `ontology.json` is valid JSON with validated structure: `entities` array (each has `name` and `type`), `relationships` array (each has `source`, `target`, `type`), committed to git
- Helper functions handle network errors with retry-once-then-fail strategy
- All sample data files (conversations, principles, ontology) are tracked in git for reproducibility

---

### Milestone 3: Python Script Implementation

**Deliverables**:

- Complete `examples/cognee_walkthrough.py` executable script
- Progress logging and status output
- Timestamped artifact generation
- Error handling and validation

**Steps**:

1. **Create `examples/cognee_walkthrough.py`** with modular async functions:
   - `setup_environment()`: Load .env, validate API key, create artifacts directory
   - `get_timestamp()`: Generate timestamp string for artifact naming (format: YYYYMMDD_HHMMSS)
   - `prepare_data()`: Define developer intro text, call download_remote_assets(), preview files
   - `reset_memory()`: Call cognee.prune functions to clear data and system metadata
   - `ingest_data()`: Add developer intro, conversations, and principles to respective nodesets
   - `build_knowledge_graph()`: Set ONTOLOGY_FILE_PATH env var, call cognee.cognify()
   - `visualize_graph()`: Generate timestamped HTML visualization files
   - `enhance_memory()`: Call cognee.memify() to add semantic connections
   - `search_cross_document()`: Execute cross-document GRAPH_COMPLETION search
   - `search_filtered()`: Execute NodeSet-filtered search on principles_data
   - `provide_feedback()`: Execute search with save_interaction=True, then provide FEEDBACK query
   - `main()`: Orchestrate all functions sequentially with try/except error handling

2. **Script structure requirements**:
   - Shebang line for direct execution: `#!/usr/bin/env python3`
   - Import: asyncio, os, sys, datetime, pathlib, dotenv, cognee
   - Add parent directory to sys.path to import utils module
   - Use asyncio.run(main()) as entry point

3. **Progress output requirements**:
   - Print section headers with === separators for each major step
   - Use ✓ checkmarks for completed actions
   - Display artifact filenames and paths as they're generated
   - Show query text before executing searches
   - Print final summary with all generated artifact paths

4. **Error handling requirements**:
   - Check for OPENAI_API_KEY before proceeding; exit with code 1 if missing
   - Wrap main execution in try/except to catch and display errors with traceback
   - Network errors in asset download: retry once, then abort with clear error message (fail-fast strategy)
   - If `cognify()` or `memify()` returns empty or structurally invalid graph, log warning but continue execution (allows partial completion for debugging)
   - Avoid logging or echoing API key value in any error messages or console output

5. **Timestamp artifact naming**:
   - Generate single timestamp at start of execution using format YYYYMMDD_HHMMSS (rationale: emphasizes single coherent run; all artifacts grouped together)
   - Use naming pattern: `graph_{stage}_{timestamp}.html`
   - Stage values: "initial" (after cognify), "enhanced" (after memify), "final" (after feedback)
   - Example: `graph_initial_20251109_143022.html`
   - Timestamp includes seconds for uniqueness; microseconds not required for typical usage patterns

6. **Performance logging**:
   - Log start time and completion time for each major stage (setup, data prep, reset, ingest, cognify, memify, searches, feedback)
   - Print total elapsed time at end of execution to support "under 5 minutes" validation

7. **Make script executable**:
   - Run `chmod +x examples/cognee_walkthrough.py` after creation

**Acceptance Criteria**:

- Script runs without errors when executed with `python examples/cognee_walkthrough.py`
- All user-visible workflow steps execute sequentially with clear progress output (setup, data prep, reset, ingest, cognify, visualize initial, memify, visualize enhanced, search cross-doc, search filtered, feedback, visualize final)
- Script exits with error code 1 if OPENAI_API_KEY is missing
- Three timestamped HTML visualization files are generated in `artifacts/` following pattern `graph_{stage}_{timestamp}.html`
- Artifact filenames use stage values: "initial", "enhanced", "final" with YYYYMMDD_HHMMSS timestamp (all sharing same timestamp from run start)
- Search queries return non-empty results
- Search results are contextually relevant: contain at least one reference to developer intro text AND include nodes connected via ontology-derived relationships
- Feedback mechanism completes without errors
- Script completes in under 5 minutes on cold run (includes asset downloads, network and API dependent; ~15-20 OpenAI API calls)
- Total elapsed time is logged at script completion
- Error messages are clear and actionable
- API key value is never logged or echoed to console

---

### Milestone 4: Documentation

**Deliverables**:

- Comprehensive README documentation
- Environment setup guide
- Troubleshooting section
- Expected outputs documentation

**Steps**:

1. **Update `README.md`** with sections covering:
   - Project overview and learning objectives (nodesets, ontology, visualization, search, feedback)
   - Prerequisites: Python 3.8+, OpenAI API key (note about free tier limitations and ~$0.01-0.05 estimated cost), disk space
   - Installation steps: clone repo, create virtualenv, install requirements, configure .env
   - Usage instructions: how to run `python examples/cognee_walkthrough.py`
   - Project structure: directories and their purposes
   - Expected outputs: three timestamped HTML visualizations with descriptions
   - Version disclaimer: "Last tested with cognee 0.3.4"
   - Alternative LLM provider configuration instructions (setting different API keys/endpoints)
   - Troubleshooting: rate limits, import errors, missing artifacts, network failures
   - Links to official Cognee docs, GitHub repo, Colab notebook, Discord

2. **Create `artifacts/README.md`**:
   - Explain that this directory contains timestamped HTML visualizations
   - Document naming convention: `graph_{stage}_{timestamp}.html`
   - Describe the three stages: initial (after cognify), enhanced (after memify), final (after feedback)
   - Instructions: open any HTML file in browser for interactive exploration

3. **Create `data/sample/README.md`**:
   - Explain automatic download behavior on first run
   - List files: human_agent_conversations.json, python_zen_principles.md, ontology.json
   - Note that files are fetched from Cognee examples repo and then versioned locally

4. **Create `Planning/002-expected-outputs.md`** documenting:
   - Expected search result formats and sample outputs
   - Typical API call counts and timing estimates
   - Example console output showing progress messages
   - Description of HTML visualization structure

**Acceptance Criteria**:

- README includes all installation and usage instructions for virtualenv workflow
- Troubleshooting section covers at least 3 common issues (rate limits, imports, artifacts)
- artifacts/README.md explains timestamped file naming convention
- data/sample/README.md explains automatic download behavior
- All documentation uses correct file paths relative to repo root
- External links to Cognee documentation are valid and current

---

## Validation

### Pre-Implementation Checklist

- [ ] All open questions resolved
- [ ] Python 3.8+ confirmed available
- [ ] OpenAI API access confirmed (or alternative provider selected)
- [ ] Directory structure approved
- [ ] Dependency versions validated

### Implementation Validation

**Milestone 1**:

- [ ] All directories created and committed to git
- [ ] `requirements.txt` installs without errors (cognee + minimal deps)
- [ ] `.env.example` documents all required variables (OPENAI_API_KEY, ONTOLOGY_FILE_PATH)
- [ ] `.gitignore` excludes all sensitive and timestamped artifact files

**Milestone 2**:

- [ ] `developer_intro.txt` created with specified content
- [ ] `utils/asset_helpers.py` successfully downloads missing files from Cognee repo
- [ ] Downloaded files are valid JSON/markdown format
- [ ] `human_agent_conversations.json` committed to git with validated role values
- [ ] `python_zen_principles.md` committed to git with PSF license attribution
- [ ] `ontology.json` committed to git with validated entity and relationship structure
- [ ] Helper functions handle network errors with retry-once-then-fail strategy

**Milestone 3**:

- [ ] Script runs end-to-end without errors
- [ ] All user-visible workflow steps execute sequentially with clear progress output
- [ ] Three timestamped HTML visualization files generated in `artifacts/`
- [ ] Artifact filenames follow exact pattern: `graph_initial_YYYYMMDD_HHMMSS.html`, `graph_enhanced_YYYYMMDD_HHMMSS.html`, `graph_final_YYYYMMDD_HHMMSS.html` (all with same timestamp)
- [ ] Search queries return non-empty results
- [ ] Search results contain at least one reference to developer intro text
- [ ] Search results include nodes connected via ontology-derived relationships
- [ ] Feedback mechanism completes successfully
- [ ] Script exits with code 1 when OPENAI_API_KEY is missing
- [ ] Error messages are clear and actionable
- [ ] API key value never appears in logs or console output
- [ ] Total elapsed time logged at completion
- [ ] Execution completes in under 5 minutes (cold run with downloads)
- [ ] Execution makes approximately 15-20 OpenAI API calls

**Milestone 4**:

- [ ] README installation instructions tested on clean virtualenv
- [ ] README includes "Last tested with cognee 0.3.4" disclaimer
- [ ] README documents alternative LLM provider configuration
- [ ] README includes API cost estimate (~$0.01-0.05 per run)
- [ ] Documentation links validated
- [ ] Troubleshooting section covers observed issues including network failures
- [ ] artifacts/README.md explains timestamped file naming (all three files share same timestamp)
- [ ] data/sample/README.md explains automatic download behavior

### Automated Tests

No automated tests are required for this initial prototype, but consider adding:

- Unit tests for `utils/asset_helpers.py`
- Integration test that runs the full script with mocked Cognee calls
- Validation that sample data files conform to expected schemas

### Manual Tests

1. **Fresh Environment Test**:
   - Clone repo to new directory
   - Create virtual environment
   - Install dependencies
   - Configure .env with API key
   - Run standalone script
   - Verify three timestamped HTML files generated
   - Verify artifacts follow naming convention

2. **API Key Validation Test**:
   - Remove OPENAI_API_KEY from environment
   - Run script
   - Verify error message and exit code 1

3. **Data Download Test**:
   - Delete `data/sample/` directory
   - Run script
   - Verify files are downloaded from Cognee repo
   - Verify files are valid JSON/markdown

4. **Malformed Data Test**:
   - Create `data/sample/ontology.json` with missing `entities` key
   - Run script
   - Verify validation fails with clear error message
   - Restore valid ontology

5. **Network Failure Test**:
   - Simulate network failure during asset download (disconnect network or use invalid URL)
   - Verify script retries once then fails with clear error
   - Verify no partial/corrupt files written

6. **Timestamp Uniqueness Test**:
   - Run script twice in succession
   - Verify artifacts have different timestamps
   - Verify no file overwrites occur

---

## Risks

### High Severity

1. **API Rate Limits**: OpenAI free tier insufficient for walkthrough execution (~15-20 API calls required; estimated cost $0.01-0.05 with gpt-3.5-turbo)
   - **Mitigation**: Document API usage and cost estimates in README; provide alternative LLM provider configuration instructions in README
   
2. **Cognee Version Compatibility**: Breaking changes in cognee 0.3.x may invalidate tutorial steps
   - **Mitigation**: Pin exact version (0.3.4); monitor Cognee release notes; test on version upgrades; include "last tested with cognee 0.3.4" disclaimer in README

3. **Missing Dependencies**: Transitive dependency conflicts or missing system libraries
   - **Mitigation**: Test on multiple Python versions (3.8, 3.9, 3.10); document system requirements

4. **Large Artifact Files**: HTML visualizations may exceed reasonable file sizes for git storage
   - **Mitigation**: Ensure artifacts/ is gitignored; document expected file sizes in README

5. **Sample Data Availability**: Remote assets from Cognee repo may move or become unavailable
   - **Mitigation**: Version sample data files in repo after first download; make remote fetch optional; implement retry-once strategy for downloads

6. **Cross-Platform Path Issues**: Windows vs Linux path handling in artifact generation
   - **Mitigation**: Use `pathlib.Path` for all file operations; test on Windows

7. **Documentation Drift**: Cognee docs may update faster than this implementation
   - **Mitigation**: Include "last tested with cognee 0.3.4" disclaimer in README; link to official docs

8. **Timestamp Collisions**: Running script multiple times per second may cause filename conflicts
   - **Mitigation**: Use datetime with microseconds if needed; implement collision detection

---

## Rollback Considerations

This is a net-new implementation with no existing functionality to preserve. If implementation fails:

- Remove `examples/`, `utils/`, and timestamped files in `artifacts/`
- Preserve downloaded data files in `data/sample/` (already versioned in git)
- Remove `.cognee/` directory if present to clear Cognee's local storage state
- Revert `requirements.txt`, `.env.example`, `.gitignore`, `README.md`
- Preserve `Planning/` directory for future attempts

No database migrations or production systems are affected.

---

## Handoff Notes

**For Implementer**:

1. Start with Milestone 1 (directory structure) before writing any code
2. Commit all sample data files (conversations, principles, ontology) to git in Milestone 2
3. Validate ontology.json contains `entities` and `relationships` keys before proceeding to Milestone 3
4. Test the script incrementally, verifying each function works before moving to the next
5. If any step fails, check Cognee documentation for API changes before debugging
6. All file paths use `pathlib.Path` (stdlib module, no installation required) for cross-platform compatibility
7. Use plain text ✓ checkmarks and === separators for progress visibility (ANSI colors optional)
8. Artifact naming must follow exact pattern: `graph_{stage}_{timestamp}.html` with stage = "initial"|"enhanced"|"final"; all three artifacts share same timestamp from run start
9. Test with missing API key to verify error handling with exit code 1
10. Network errors during asset download: retry once, then fail with clear error message (fail-fast strategy)
11. Empty or invalid graphs from `cognify()`/`memify()` should log warning but continue (allows partial completion for debugging)
12. Log stage durations and total elapsed time to support performance validation

**For Reviewer**:

1. Verify all three HTML visualizations open in a browser without errors
2. Verify artifact filenames match exact pattern: `graph_initial_YYYYMMDD_HHMMSS.html`, `graph_enhanced_YYYYMMDD_HHMMSS.html`, `graph_final_YYYYMMDD_HHMMSS.html` (all with same timestamp)
3. Confirm search results are non-empty
4. Confirm search results contain at least one reference to developer intro text
5. Confirm search results include nodes connected via ontology-derived relationships
6. Check that .env file is gitignored and .env.example exists with OPENAI_API_KEY and ONTOLOGY_FILE_PATH documented
7. Test README installation instructions on a clean Python 3.8+ virtualenv
8. Verify all sample data files (conversations, principles, ontology) are committed to git
9. Verify `human_agent_conversations.json` has validated role values ("user"/"assistant")
10. Verify `python_zen_principles.md` includes PSF license attribution
11. Verify `ontology.json` has validated structure (entities with name/type, relationships with source/target/type)
12. Validate that no hardcoded API keys or secrets are committed or logged
13. Confirm total elapsed time is logged at script completion
14. Priority validation: Fresh Environment Test (most critical manual test for deployment confidence)

**For Critic**:

- Assess if plan's ontology validation requirements are sufficient for cognee 0.3.4 compatibility (entities with name/type, relationships with source/target/type)
- Evaluate whether downloaded conversation data expectations are realistic for meaningful graph construction
- Review whether error handling strategy is appropriate (retry-once for network, log-and-continue for empty graphs)
- Assess if progress output and logging provide enough visibility (~12 user-visible workflow steps plus stage durations)
- Evaluate API cost estimation accuracy (~15-20 calls, $0.01-0.05 with gpt-3.5-turbo)
- Consider if additional examples (alternative LLM providers, custom ontologies) should be planned separately or deferred

---

## Additional Context

**Clarifications Resolved**:

1. **Artifact Naming**: All three artifacts share single timestamp from run start using format `graph_{stage}_{timestamp}.html` with stage = "initial"|"enhanced"|"final" and timestamp YYYYMMDD_HHMMSS; rationale is to group artifacts from single coherent run
2. **Sample Data Strategy**: All sample files (conversations, principles, ontology) committed to git in Milestone 2 for reproducibility
3. **Conversation Schema**: Role values constrained to "user" or "assistant"; chronological ordering if timestamps present
4. **Ontology Validation**: Must contain `entities` array (each with `name` and `type` fields) and `relationships` array (each with `source`, `target`, `type` fields) for cognee 0.3.4 compatibility
5. **Search Result Quality**: Non-empty results that contain at least one reference to developer intro text AND include nodes connected via ontology-derived relationships
6. **Error Handling Strategy**: Network errors retry once then fail-fast; empty/invalid graphs from cognee operations log warning but continue for debugging
7. **Performance Tracking**: Log stage durations and total elapsed time; target is under 5 minutes on cold run (with downloads)
8. **API Cost**: Estimated 15-20 OpenAI API calls at ~$0.01-0.05 total cost with gpt-3.5-turbo
9. **Security**: API key value never logged or echoed to console
10. **Licensing**: PSF license attribution required for Zen of Python content

The plan is complete and ready for implementation.
