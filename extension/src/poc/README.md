# POC Directory (TypeScript)

> [!CAUTION]
> **SUPERSEDED by Plan 073** - POC evaluation complete 2025-12-24.
> 
> The synthesis functionality validated by these POCs is now production code at:
> - `extension/src/synthesis/copilotSynthesis.ts` - Production synthesis module
> - `extension/src/flowbabyClient.ts` - Integration with retrieve() method
>
> This directory is retained for historical reference only and is excluded from builds.
> Consider deleting this entire `poc/` directory in a future cleanup pass.

## Historical Contents

- `synthesisQualityPoc.ts` - POC-2: Validated Copilot synthesis quality and latency

## POC Results Summary (2025-12-24)

**POC-1 (Bridge)**: Validated `only_context=True` return format
- Return type: `list[dict]` with graphContext string
- Latency: ~2s (vs 18-35s with LLM call)
- JSON serializable: ✅

**POC-2 (Synthesis)**: Validated Copilot synthesis quality
- Avg latency: ~2.2s
- Quality: Acceptable for production
- Prompt injection guardrails: Effective

## Legacy Usage (No Longer Needed)

1. Add to `extension.ts` activation:
   ```typescript
   import { registerPoc2Commands } from './poc/synthesisQualityPoc';
   registerPoc2Commands(context);
   ```

2. Add to `package.json` commands:
   ```json
   {
     "command": "flowbaby.poc2c.runSynthesis",
     "title": "Flowbaby: Run POC-2c Synthesis Test"
   }
   ```

3. Run extension in debug mode and execute command from palette

## Results

Output is saved to `extension/bridge/poc_results/`
