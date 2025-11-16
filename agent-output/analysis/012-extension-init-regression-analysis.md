# Value Statement and Business Objective

As an extension user, I want Cognee Chat Memory 0.2.1 to initialize successfully after installation so that I can capture and recall workspace context without setup blockers.

## Objective

- Identify why the installed 0.2.1 VSIX shows "Ontology file not found" and outdated API key guidance.
- Determine how these regressions relate to the broader workspace-isolated storage initiative delivered in Plans 010/011.
- Recommend concrete next steps that unblock users and preserve the intended value of on-by-default memory capture.

## Methodology

- Reviewed the reported VS Code notifications and output logs (attachments) to capture user-visible failures.
- Inspected `extension/bridge/init.py` to understand runtime expectations around ontology loading and API keys.
- Listed the packaged bridge directory to verify whether `ontology.json` ships with 0.2.1.
- Examined `extension/src/extension.ts` and `extension/src/cogneeClient.ts` for onboarding copy and sensitive-value redaction paths.
- Cross-referenced existing QA/UAT documents (Plans 010/011) to understand intended behavior for `LLM_API_KEY` enforcement and ontology validation.

## Findings

1. **Ontology payload mismatch (TTL vs JSON) blocks initialization**
   - `extension/bridge/init.py` still hardcodes `ontology_path = Path(__file__).parent / 'ontology.json'` (lines 176-182). If the file is absent, the initializer returns `{ success: False, error: 'Ontology file not found: …/bridge/ontology.json' }`, matching the screenshot path under the user’s `$HOME/.vscode/extensions` directory.
   - The bridge directory intentionally replaced `ontology.json` with `ontology.ttl` during recent cleanups, but the Python loader was never updated to parse TTL, so every installed build now fails even though the ontology data is present in a different format.
   - Because initialization halts before ingestion, all downstream capabilities (capture commands, @cognee-memory participant) remain inactive, negating the value delivered by Plans 010/011.

2. **Onboarding guidance still instructs `OPENAI_API_KEY`, confusing users**
   - When initialization fails, `extension.ts` prints "Missing OpenAI API Key" and tells users to add `OPENAI_API_KEY=…`. The codebase, QA docs, and Python bridge were updated to require `LLM_API_KEY`, so the UI now contradicts actual requirements.
   - `cogneeClient.ts` redaction logic also only masks `OPENAI_API_KEY`, meaning logs could leak the new variable name/value if users follow updated docs elsewhere.
   - The warning output in the screenshot echoes the obsolete guidance, demonstrating that even correctly configured environments will waste time troubleshooting the wrong variable.

3. **Packaging/tests lack regression coverage for bridge assets and onboarding text**
   - There are no automated checks ensuring `ontology.json` (or its successor) is included in the VSIX, nor tests asserting the initialization help text references the current environment variable.
   - QA/UAT artifacts focused on pytest success and workspace storage migration but explicitly noted missing manual validation of bridge scripts due to unavailable `LLM_API_KEY`, leaving this gap undetected until user installation.
   - Without packaging smoke tests, future updates risk similar omissions (e.g., prompt templates, schema files) that break initialization silently.

## Recommendations

1. **Align loader with TTL-based ontology**
   - Update `extension/bridge/init.py` (and any downstream consumers) to parse `ontology.ttl` directly or convert TTL to the JSON structure expected by ingestion at build time; removing the stale JSON dependency eliminates the missing-file error without reintroducing redundant assets.
   - Add a unit or smoke test under `extension/bridge/tests/` that exercises the TTL parsing path so CI fails if the ontology asset is missing or malformed.

2. **Update onboarding/error messaging to `LLM_API_KEY`**
   - Replace `OPENAI_API_KEY` references in `extension/src/extension.ts`, `cogneeClient.ts`, docs, and tests with `LLM_API_KEY` while preserving backward-compatible redaction (mask both names).
   - Re-run `npm run compile` and rebuild the VSIX to ensure the updated text ships with 0.2.1 (or bump to 0.2.2 if necessary).

3. **Add packaging verification**
   - Introduce a lightweight script (e.g., `npm run verify:vsix`) that inspects the built VSIX contents for required files (`bridge/ontology.json`, `bridge/requirements.txt`, etc.) before release.
   - Integrate the check into the release checklist (`extension/RELEASE_CHECKLIST.md`) so regressions surface before publishing.

## Testing Infrastructure Requirements

- Node.js/npm plus `@vscode/vsce` to rebuild and inspect the VSIX after restoring the ontology file.
- Python 3.12 environment with `cognee` and `python-dotenv` (as already listed in `bridge/requirements.txt`) to rerun bridge pytest suites once the file is restored.
- Access to a valid `LLM_API_KEY` (or mocked harness) to confirm initialization succeeds end-to-end after packaging fixes.

## Scope Considerations

- If the team intends to consolidate on `ontology.ttl`, consider updating `init.py` to parse TTL instead of JSON, avoiding duplicate artifacts. This is outside the immediate fix but worth tracking once initialization is unblocked.
- Updating user-facing docs (README, SETUP) to emphasize `LLM_API_KEY` should accompany the code changes for consistency.

## Open Questions

1. Should `init.py` migrate entirely to `ontology.ttl`, or is JSON still the canonical format expected by downstream ingestion?
2. Do we need backward compatibility for existing users who may still have `OPENAI_API_KEY` set, or can we provide a migration shim (e.g., read either variable)?
3. Is additional telemetry/logging needed to detect missing packaged assets before users report them?

## References

- `extension/bridge/init.py` lines 170-195 (ontology loading and error return).
- `extension/bridge/` directory listing (absence of `ontology.json`).
- `extension/src/extension.ts` lines 40-60 (obsolete API key guidance).
- QA report `qa/010-fix-ingestion-failures-and-workspace-storage-qa.md` (LLM_API_KEY requirements noted but untested).
