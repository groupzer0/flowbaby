# Analysis Documents

This directory contains research and analysis reports created by the Analyst chatmode to inform planning decisions.

## Purpose

Analysis documents provide deep technical research into APIs, libraries, architectural patterns, or unknowns that would otherwise block or weaken planning. These reports are created **before planning begins** to bridge knowledge gaps and enable informed decision-making.

## Document Naming Convention

Analysis documents are named to match their related planning documents:

- Format: `NNN-plan-name-analysis.md` (matches plan number and name, appends `-analysis`)
- Examples:
  - Plan: `003-fix-workspace-isolation-and-ontology.md` → Analysis: `003-fix-workspace-isolation-and-ontology-analysis.md`
  - Plan: `005-implement-caching-layer.md` → Analysis: `005-implement-caching-layer-analysis.md`
- For standalone research not tied to a specific plan: `NNN-descriptive-topic-analysis.md`

This naming scheme makes it easy to identify which analysis documents relate to which plans.

## Document Structure

Each analysis document should include:

1. **Objective**: What question(s) this research answers
2. **Methodology**: How the research was conducted (tools used, tests run, sources consulted)
3. **Findings**: Detailed results with code examples, test outputs, and observations
4. **Recommendations**: Clear guidance for the planner
5. **Open Questions**: Any unresolved issues or follow-up research needed
6. **References**: Links to documentation, GitHub repos, or other sources

## Workflow

Analyst can be invoked at multiple stages:

### Pre-Planning or During Planning

1. **Planner identifies unknowns** → Requests analyst research
2. **Analyst investigates** → Creates numbered analysis document
3. **Planner incorporates findings** → References analysis in plan

### During Implementation

1. **Implementer encounters uncertainty** → Requests analyst research
2. **Analyst investigates** → Creates numbered analysis document
3. **Implementer resumes** → Uses analysis findings to proceed

### Usage

- **Implementer executes** → Uses both plan and analysis documents as context
- Analysis documents provide detailed technical findings beyond the scope of plans

## Relationship to Planning

- Analysis documents are **inputs to planning**, not plans themselves
- Planners reference analysis documents when creating implementation plans
- Analysis focuses on **what is possible/feasible**, plans focus on **what will be done**

## Constraints

- Analyst cannot modify application source code (only temporary test files for research)
- Analyst cannot create or modify planning documents (that's Planner's domain)
- Analysis must be completed before implementation begins
