# Planning Documents

This directory contains implementation-ready plans created by the Planner chatmode for codebase changes.

## Purpose

Planning documents translate product goals and requirements into actionable, verifiable work packages that guide implementation. These plans are created **after research/analysis is complete** and **before implementation begins**.

## Document Naming Convention

Planning documents use sequential numbering with descriptive names:

- Format: `NNN-descriptive-feature-or-fix-name.md`
- Examples:
  - `001-cognee-walkthrough-implementation.md`
  - `002-automatic-context-retrieval.md`
  - `003-fix-workspace-isolation-and-ontology.md`

## Document Structure

Each planning document should include:

1. **Objective**: Clear statement of what will be accomplished and why
2. **Assumptions**: Known constraints, dependencies, and context
3. **Plan**: Discrete tasks with explicit objectives, acceptance criteria, and dependencies
4. **Validation**: Required tests, checks, and verification steps
5. **Risks**: Potential blockers, rollback considerations, and mitigation strategies

## Planning Style

Plans provide **high-level guidance**, not implementation code:

- Describe **WHAT** needs to be implemented and **WHERE**
- Avoid writing the full **HOW** (detailed code)
- Use pseudocode or brief examples only when necessary to clarify architecture
- Reference file paths, function names, and interfaces explicitly
- Include specific verification steps and acceptance criteria

Example appropriate descriptions:

- ✅ "Create `CogneeClient.initialize()` method that calls Python bridge's `init.py` and logs returned ontology info"
- ✅ "Update `ingest.py` to configure workspace-local data directory before importing cognee"
- ❌ [200 lines of complete implementation code]

## Workflow

1. **Requirements identified** → Planner gathers context
2. **If unknowns exist** → Analyst researches and documents findings
3. **Planner creates plan** → References analysis documents if applicable
4. **Critic reviews plan** → Evaluates clarity, completeness, architectural alignment
5. **Implementer executes** → Follows plan step-by-step
6. **If implementation encounters uncertainty** → Analyst researches and documents findings, implementer resumes
7. **Reviewer validates** → Confirms implementation matches plan

## Relationship to Analysis

- Plans may reference analysis documents from `analysis/` directory
- Analysis documents match plan names with `-analysis` suffix (e.g., `003-fix-workspace.md` → `analysis/003-fix-workspace-analysis.md`)
- Analysis provides **what is possible/feasible**, plans provide **what will be done**
- If significant unknowns exist, request Analyst research before planning

## Review Process

All plans should be reviewed by the Critic chatmode before implementation to ensure:

- Clarity and completeness
- Architectural alignment with existing codebase
- Appropriate scope (not too narrow or too broad)
- Technical debt and complexity risks are addressed
- Long-term maintainability considerations

## Constraints

- Planner cannot edit source code, config files, or tests
- Planner only creates/updates planning artifacts in `planning/` directory
- Plans guide implementers but don't replace their coding work
- If requirements are unclear or conflict, planning stops until clarification is received
