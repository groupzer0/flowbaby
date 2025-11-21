# Critique: 017-async-cognify-optimization

**Plan**: `agent-output/planning/017-async-cognify-optimization.md`  
**Analysis**: `agent-output/analysis/017-async-cognify-optimization-analysis.md`  
**Architecture Findings**: `agent-output/architecture/017-async-cognify-optimization-architecture-findings.md`  
**Critic Review Date**: 2025-11-20  
**Status**: Revision 1

## Changelog

| Date | Agent Handoff | Request | Summary of Changes |
|------|---------------|---------|-------------------|
| 2025-11-20 | Planner → Critic | Initial Review | Initial critique created; prior critique artifact was deleted |
| 2025-11-20 | Planner → Critic | Post-revision review | Plan updated per critique (removed prescriptive code, consolidated value statement, clarified throttle policy, added manual capture async rationale). Critique updated with resolved findings & new inconsistencies identified (testing strategy + outdated analysis). |

---

## Value Statement Assessment

Plan revision presents a single-line, outcome-focused user story that satisfies required format and directly aligns with Master Product Objective (reduce cognitive overhead via responsiveness + transparent error surfacing). Formatting issue (line breaks) resolved. Core value is not deferred. Residual concern: downstream Testing Strategy still contains a contradictory manual capture sync validation (suggesting legacy behavior) which implicitly challenges universal async value delivery and must be removed to avoid ambiguity.

## Overview

Revised plan cleanly specifies async split (add-only immediate return; cognify-only background) with universal application (agent tools, manual capture, headless commands). Success + failure notifications with independent per-outcome throttling are stated; architecture file phrases shared throttle budget “per outcome type” which effectively matches independence. Milestone sections retain acceptance criteria (acceptable) and removed prior completion checkmarks, improving separation between planning and execution. Testing section introduces a new inconsistency (manual capture sync test) contradicting universal async adoption.

## Architectural Alignment

Alignment improved: prescriptive code removed; rationale for universal async (including manual capture) explicitly called out with architecture decision timestamp (13:45). Notification throttling clarified as independent per outcome type, consistent with architecture phrasing. Remaining misalignments:
- Ledger schema duplicated (constraints section vs detailed table) risking drift.
- Analysis document still asserts manual capture must remain synchronous (now obsolete) creating cross-artifact contradiction.
- Plan lacks schema versioning for ledger (migration/forward-compatibility concern).
- Testing Strategy contradicts universal async by expecting manual capture synchronous behavior.

## Scope Assessment

Scope still broad but no longer claims completion; acceptance criteria listed without premature success markers. Inclusion of detailed test scenarios appropriate; inconsistent manual capture sync test expands scope unintentionally (legacy pathway no longer architecturally sanctioned). Deferred items clearly enumerated. Recommend removing contradictory sync test and updating analysis to maintain artifact coherence.

## Technical Debt Risks

1. Ledger schema duplication (two authoritative definitions) invites divergence.
2. Missing explicit `schemaVersion` field in ledger impairs future migrations.
3. Cross-artifact inconsistency (analysis vs plan on manual capture sync/async) increases cognitive load and may cause implementer confusion.
4. Contradictory test scenario (manual capture sync) could reintroduce synchronous path and complexity.
5. Absence of explicit plan directive to retire synchronous manual capture mode (except for diagnostic `--mode sync`) may allow accidental user-facing exposure.

## Findings

### Critical Issues
1. **Ledger Schema Duplication** – Status: OPEN
   - Description: Schema defined in Architectural Constraints and again (expanded) in Milestone 4 table.
   - Impact: Divergence risk; implementers/QA may follow different versions; harder future migrations.
   - Recommendation: Consolidate into one canonical schema section; second location should reference canonical definition. Introduce `schemaVersion` field.

2. **Cross-Artifact Inconsistency (Analysis vs Plan on Manual Capture)** – Status: OPEN
   - Description: Analysis document still states manual capture must remain synchronous; plan + architecture adopt universal async.
   - Impact: Implementer uncertainty; potential accidental retention of sync path beyond diagnostics.
   - Recommendation: Update analysis to reflect architecture decisions (timestamps 13:25, 13:45) and explicitly deprecate synchronous manual capture except for `--mode sync` tests.

3. **Testing Strategy Contradiction (Manual Capture Sync Scenario)** – Status: OPEN
   - Description: Testing Strategy includes manual test “verify sync behavior” contrary to universal async messaging and rationale change.
   - Impact: Risk of reintroducing blocked UX or writing tests validating deprecated flow.
   - Recommendation: Replace sync verification with async staged messaging + toast completion validation.

### Medium Priority
1. **Missing Ledger Schema Version Field** – Status: OPEN
   - Description: No `schemaVersion` captured; forward compatibility/migrations harder.
   - Impact: Future evolution (retention, new fields) requires heuristic detection.
   - Recommendation: Add `schemaVersion: 1` now; increment on structural changes.

2. **Explicit Deprecation Notice for Sync Manual Capture** – Status: OPEN
   - Description: Plan implies deprecation but does not mark sync manual capture path as diagnostic-only artifact.
   - Impact: Potential accidental user exposure or leftover code path.
   - Recommendation: Add “Sync mode (manual/agent) retained for diagnostics/tests only—never exposed in production surfaces.”

### Low Priority / Observations
1. **Value Statement Formatting Resolved** – Status: RESOLVED
2. **Prescriptive Code Removed** – Status: RESOLVED
3. **Status Block Contradiction Removed** – Status: RESOLVED
4. **Notification Throttle Clarified** – Status: RESOLVED
5. **Manual Capture Rationale Added** – Status: RESOLVED
6. **Validation Section Reframed (Expected Criteria)** – Status: RESOLVED
7. **Atomic Pattern Abstracted** – Status: RESOLVED

## Questions for Planner

1. Will analysis document be updated to reflect universal async and remove synchronous manual capture assertion?
2. Can sync manual capture be explicitly marked diagnostic-only in plan to prevent accidental UX exposure?
3. Will you consolidate ledger schema and add `schemaVersion` before implementer handoff?
4. Should Testing Strategy remove the contradictory sync manual capture scenario and replace with async validation steps?
5. Do we need retention configurability surfaced (setting) in this release or defer entirely to Phase 2?
6. Is there any scenario (e.g., emergency debug) where success notifications would be suppressed—if so should plan record that exception?

## Implementation Risk Assessment

Primary risks now center on artifact inconsistency (analysis + test plan contradictions) and schema duplication. If not corrected, implementer may preserve deprecated synchronous manual capture; QA could write tests enforcing obsolete behavior. Lack of schema versioning increases future migration friction. Otherwise architectural directives are clear and actionable.

## Recommendations

- Consolidate ledger schema; introduce `schemaVersion`.
- Update analysis document to remove synchronous manual capture assertion; add rationale change section.
- Remove contradictory manual capture sync test; replace with async staged messaging verification.
- Add explicit deprecation sentence for sync ingestion (production surfaces).
- Provide quick reference pointer to architecture decision timestamps for universal async (13:25, 13:45) inside plan’s rationale section.
- Confirm retry remains manual-only; annotate plan so implementer/QA avoid speculative auto-retry.

## Revision History

### Revision 1 - 2025-11-20
- **Plan Changes**: Value statement consolidated; prescriptive code removed; notification throttling clarified; manual capture async rationale added; validation reframed as expected criteria; checkmarks removed.
- **Findings Addressed**: Contradictory status lines, prescriptive code, mixed planning/execution artifacts, notification ambiguity, value statement formatting, outdated validation blocks, atomic write over-detail, manual capture rationale absence.
- **Remaining Open**: Ledger schema duplication, missing schemaVersion, analysis/manual capture sync contradiction, testing strategy sync scenario, explicit deprecation of sync manual capture.
- **New Findings**: Testing Strategy contradiction; analysis artifact inconsistency; missing schema version field.

