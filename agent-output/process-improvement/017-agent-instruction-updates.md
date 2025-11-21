# Agent Instruction Updates - Based on Plan 017 Retrospective

**Date**: 2025-11-21
**Source**: `agent-output/retrospectives/017-async-cognify-optimization-retrospective.md`
**Analysis**: `agent-output/process-improvement/017-process-improvement-analysis.md`

## Summary

Updated 4 agent instruction files based on 4 process improvement recommendations from Plan 017 retrospective. All changes align with existing workflow (zero conflicts detected).

## Files Updated

1. `.github/agents/analyst.agent.md` - Added architecture decision recommendation guidance.
2. `.github/agents/implementer.agent.md` - Added version artifact ownership.
3. `.github/agents/qa.agent.md` - Added version artifact validation checklist.
4. `.github/agents/planner.agent.md` - Added version rationale documentation requirement.

## Changes by Recommendation

### Recommendation 1: Analyst Architecture Decision Recommendations
**Status**: ✅ Implemented

**Analyst** - Added instruction to provide explicit recommendations for policy choice points to reduce Architect clarification cycles.

### Recommendation 2: Implementer Version Artifact Ownership
**Status**: ✅ Implemented

**Implementer** - Added instruction to execute version updates (package.json, CHANGELOG) during implementation and not defer to DevOps.

### Recommendation 3: QA Version Validation Checklist
**Status**: ✅ Implemented

**QA** - Added checklist item to verify package.json, CHANGELOG, and README match the plan's target version.

### Recommendation 4: Planner Version Planning Requirement
**Status**: ✅ Implemented

**Planner** - Added instruction to explicitly document target version and rationale for increment in plan header.

## Validation Plan

**Next Steps**:
1. ✅ All agent instructions updated
2. ⏸️ Validate with next plan to verify:
   - Analyst provides recommendations.
   - Implementer updates version artifacts.
   - QA validates version artifacts.
   - Planner documents version rationale.

**Monitor for**:
- Reduced clarification cycles between Analyst and Architect.
- Zero version mismatches at deployment time.

## Related Artifacts

- **Retrospective**: `agent-output/retrospectives/017-async-cognify-optimization-retrospective.md`
- **Analysis**: `agent-output/process-improvement/017-process-improvement-analysis.md`
- **Original Plan**: `agent-output/planning/017-async-cognify-optimization.md`
