# QA Agent Guidelines

## Purpose

These instructions ensure every QA handoff validates that implementations deliver the scoped plan, expose misalignments early, and document the verification work in the `agent-output/qa/` reports.

## Core Responsibilities

- **Plan ↔ Implementation Alignment**: Confirm the implementation labeled for Plan `XYZ` actually fulfills that plan's acceptance criteria. Flag missing scope, partially completed tasks, or unrelated features shipped under the same ID.
- **Overreach Detection**: Note any functionality added beyond the documented plan. Overreach must either be justified (and referenced) or recorded as a finding so planners can triage.
- **Evidence-Driven Testing**: Derive tests from both the plan requirements and the observed code changes. If implementation details introduce new behavior, tests must cover that behavior even if the plan did not call it out explicitly.
- **Result Transparency**: Capture executed commands, pass/fail status, gaps, and follow-up actions inside the plan-specific QA report (e.g., `agent-output/qa/013-*.md`).

## Required QA Checklist per Plan

1. **Cross-Reference Documents**
   - Read `agent-output/planning/<plan>.md` for acceptance criteria and constraints.
   - Read `agent-output/implementation/<plan>-implementation.md` (or equivalent) to understand delivered work and any noted deviations.
2. **Gap & Misalignment Review**
   - Verify every acceptance criterion has a corresponding implementation change or test.
   - Identify missing functionality, partial work, or regressions introduced by the new code.
   - Ensure implementation IDs, filenames, and references match the target plan number.
3. **Overreach Audit**
   - Document any extra features or refactors delivered alongside the plan. Confirm whether tests cover them; if not, raise as QA findings.
4. **Test Design & Execution**
   - Add or update automated tests based on (a) explicit plan requirements and (b) discovered implementation details.
   - Prefer runnable suites (e.g., `npm test`, `pytest`, `npm run test:bridge`). Include the exact commands in the QA report.
   - Where automation is not feasible, outline manual steps and expected outcomes.
5. **Reporting**
   - Summarize coverage, findings, and status (QA Complete / QA Failed) in the plan-specific QA markdown file.
   - Call out next actions for planners/implementers when misalignment or missing tests are found.

## Escalation Guidelines

- If scope gaps or overreach are severe, stop testing and request planner guidance before proceeding.
- When blocking issues stem from upstream plans or dependencies, note them explicitly so they can be triaged.

Follow this document for every new QA engagement to maintain consistent standards across plans.

For the full QA agent role definition and workflow, see `.github/agents/qa.agent.md`; this README highlights the practical checklist that complements those canonical instructions.
