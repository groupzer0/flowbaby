# Agent Workflow System

## Overview

This repository uses a structured multi-agent workflow system with **10 specialized agents** that collaborate to deliver high-quality software changes. Each agent has a specific domain of expertise and produces artifacts in dedicated directories.

## Agent Roster

| Agent | Domain | Artifacts Directory | Model |
|-------|--------|-------------------|-------|
| **Planner** | Strategic planning | `planning/` | Claude Sonnet 4.5 |
| **Analyst** | Technical research | `analysis/` | GPT-5.1 |
| **Critic** | Plan & analysis review | `critiques/` | GPT-5.1 |
| **Architect** | Architectural coherence | `architecture/` | Claude Sonnet 4.5 |
| **Implementer** | Code execution | `implementation/` | Claude Sonnet 4.5 |
| **QA** | Technical quality | `qa/` | GPT-5.1 |
| **Reviewer** | Value delivery & release | `uat/` | Claude Sonnet 4.5 |
| **DevOps** | Packaging & deployment | `deployment/` | Claude Sonnet 4.5 |
| **Escalation** | Go/no-go decisions | `escalations/` | GPT-5.1 |
| **Retrospective** | Lessons learned | `retrospectives/` | Claude Sonnet 4.5 |

## Standard Workflow

```
┌─────────────┐
│   Planner   │──────┐
│  (planning) │      │ Invokes research when
└──────┬──────┘      │ encountering unknowns
       │             ↓
       │      ┌─────────────┐
       │      │   Analyst   │
       │      │  (analysis) │
       │      └──────┬──────┘
       │             │
       ↓             ↓
┌─────────────┐ ← ← ← ← 
│   Critic    │  May request
│ (critiques) │  more analysis
└──────┬──────┘
       │
       ├────────────────────────────┐
       │ Plan approved              │ Plan needs revision
       ↓                            ↓
┌─────────────┐            Back to Planner
│ Implementer │
│(implementa- │
│    tion)    │
└──────┬──────┘
       │
       ↓
┌─────────────┐
│     QA      │ ← ← ← Fixes → → →
│    (qa)     │                  ↓
└──────┬──────┘            Back to Implementer
       │ QA Complete              if tests fail
       ↓
┌─────────────┐
│  Reviewer   │ ← ← ← Fixes → → →
│   (uat)     │                  ↓
└──────┬──────┘            Back to Implementer
       │ UAT Complete             if value gaps
       │ + Release Decision
       ↓
┌─────────────┐
│   DevOps    │ ← ← ← Fixes → → →
│(deployment) │                  ↓
└──────┬──────┘            Back to Implementer
       │ Requires User           if packaging issues
       │ Confirmation
       │ for Release
       ↓
┌─────────────┐
│Retrospective│
│(retrospec-  │
│   tives)    │
└─────────────┘

         Cross-Cutting Agents
         ═══════════════════

┌─────────────┐         ┌─────────────┐
│  Architect  │         │ Escalation  │
│(architecture)│        │(escalations)│
└─────────────┘         └─────────────┘
  Invoked for              Invoked when
  architectural            agents reach
  guidance &               blocking
  ADRs                     impasses
```

## Agent Capabilities

### **Planner** (Strategic Planning)
- Creates implementation-ready plans with value statements
- Defines high-level testing strategy (not specific test cases)
- **MUST hand off to Critic** after completing plan
- Invokes Analyst when encountering technical unknowns
- **Tools**: runCommands, edit, search, todos, usages, fetch, githubRepo

### **Analyst** (Technical Research)
- Investigates APIs, libraries, frameworks through hands-on experimentation
- Tests behavior, documents findings with code examples
- Can invoke itself iteratively ("Deepen Research" handoff)
- Documents testing infrastructure needs explicitly
- **Tools**: runCommands, edit (analysis docs only), runNotebooks, search, usages, vscodeAPI, problems, fetch, githubRepo

### **Critic** (Plan & Analysis Review)
- Reviews plans AND analysis documents for quality
- Identifies architectural misalignments and technical debt risks
- Creates critique documents with "Implementation Risk Assessment"
- Can request more analysis or approve for implementation
- **Edit tool ONLY for critique documents**
- **Tools**: search, fetch, githubRepo, usages, runCommands, edit (critique docs only)

### **Architect** (Architectural Coherence)
- Maintains system-level design coherence across features
- Produces Architectural Decision Records (ADRs)
- Reviews technical debt and recommends refactoring priorities
- Invoked before complex features or periodically for audits
- **Tools**: search, usages, fetch, githubRepo, edit (ADRs only)

### **Implementer** (Code Execution)
- Executes approved plans step-by-step
- Flags conflicts between plan and QA test strategy (does not guess)
- Creates implementation documentation
- **Sequential handoff**: QA first, then Reviewer (not parallel)
- **Tools**: Full development toolset including runCommands, edit, runNotebooks, runTests, fetch, Python tools

### **QA** (Technical Quality)
- **Creates test strategy BEFORE implementation** (not prescriptive test cases)
- **Can create test files proactively** - primary capability
- Identifies testing infrastructure requirements prominently
- Executes tests and validates coverage AFTER implementation
- QA failures go to Implementer (only escalate to Planner if plan flawed)
- **Tools**: search, changes, problems, testFailure, runCommands, runTests, edit

### **Reviewer** (Value Delivery & Release)
- Acts as Product Owner conducting UAT
- Reviews AFTER QA completes (sequential, not parallel)
- References QA findings to ensure technical quality resolved
- **Synthesizes final release decision**: APPROVED FOR RELEASE or NOT APPROVED
- Recommends versioning (patch/minor/major) and changelog items
- Hands off to DevOps after UAT Complete with APPROVED status
- **Tools**: search, changes, problems, testFailure, runCommands, edit, fetch

### **DevOps** (Packaging & Deployment)
- Verifies version consistency across all artifacts (package.json, CHANGELOG, docs, configs)
- Validates packaging integrity (builds, assets, verification scripts)
- **NEVER releases without explicit user confirmation** of target environment and release scope
- Executes release process systematically (git tags, registry publication, verification)
- Documents deployment in `deployment/` directory with pre-release checklist and execution log
- Hands off to Retrospective after deployment complete (success or failure)
- **Tools**: search, changes, problems, runCommands, edit

### **Escalation** (Go/No-Go Decisions)
- Makes authoritative decisions when agents reach impasses
- Resolves conflicts between agents (e.g., Planner vs. QA)
- Decides: proceed, re-plan, cancel, pivot, defer
- Creates escalation records documenting decision rationale
- **Invoked by ANY agent** encountering blocking issues
- **Tools**: search, fetch, githubRepo, usages, changes, problems, edit (escalations only)

### **Retrospective** (Lessons Learned)
- Captures insights AFTER both QA Complete and UAT Complete
- Reviews entire workflow from analysis through UAT
- Identifies patterns, process improvements, technical debt
- Creates retrospective documents for knowledge building
- **Tools**: search, usages, changes, fetch, githubRepo, edit (retrospectives only)

## Friction Points (Healthy Tensions)

These intentional tensions ensure quality:

1. **Critic challenges Planner** - prevents rushed or incomplete plans
2. **QA creates test strategy that guides Implementer** - ensures testability considered early
3. **Reviewer validates value delivery** - ensures code solves actual business problem
4. **Architect reviews system coherence** - prevents architectural drift
5. **Escalation arbitrates conflicts** - resolves agent disagreements authoritatively

## Quality Gates

Implementation must pass **sequential quality gates**:

1. **Critic approval** - Plan is sound before implementation begins
2. **QA Complete** - Technical quality validated (tests pass, coverage adequate)
3. **UAT Complete** - Business value delivered (Reviewer approval)
4. **Release Decision** - Reviewer synthesizes QA + UAT into APPROVED FOR RELEASE
5. **User Confirmation** - DevOps presents release summary and waits for explicit user approval
6. **Deployment Complete** - DevOps executes release and verifies publication

## Artifact Directories

| Directory | Owner | Purpose |
|-----------|-------|---------|
| `planning/` | Planner | Implementation plans (NNN-feature-name.md) |
| `analysis/` | Analyst | Technical research findings (NNN-feature-name-analysis.md) |
| `critiques/` | Critic | Plan/analysis reviews (NNN-feature-name-critique.md) |
| `architecture/` | Architect | Architectural Decision Records (ADR-NNN-title.md) |
| `implementation/` | Implementer | Implementation reports (NNN-feature-name-implementation.md) |
| `qa/` | QA | Test strategy & execution reports (NNN-feature-name-qa.md) |
| `uat/` | Reviewer | User Acceptance Test reports (NNN-feature-name-uat.md) |
| `deployment/` | DevOps | Deployment reports (vX.Y.Z-deployment.md) |
| `escalations/` | Escalation | Go/no-go decision records (NNN-issue-title.md) |
| `retrospectives/` | Retrospective | Lessons learned (NNN-feature-name-retrospective.md) |

## Naming Conventions

All artifacts use consistent numbering:
- Plan: `planning/003-feature-name.md`
- Analysis: `analysis/003-feature-name-analysis.md`
- Critique: `critiques/003-feature-name-critique.md`
- Implementation: `implementation/003-feature-name-implementation.md`
- QA: `qa/003-feature-name-qa.md`
- UAT: `uat/003-feature-name-uat.md`
- Deployment: `deployment/v0.2.2-deployment.md` (version-based)
- Retrospective: `retrospectives/003-feature-name-retrospective.md`

## Value-First Approach

Every plan and analysis MUST start with:

```markdown
## Value Statement and Business Objective

As a [user/customer/agent], I want to [objective], so that [value].
```

This prevents solution-first thinking and keeps work focused on actual outcomes.

## Escalation Paths

**When to escalate**:
- Blocking technical constraints
- Conflicting guidance from multiple agents
- Plan fundamentally flawed after implementation started
- QA test strategy conflicts with implementation plan

**Who decides**:
1. **User** - final authority
2. **Escalation agent** - arbitrates agent conflicts
3. **Agent consensus** - when agents align, their guidance stands
4. **Individual agents** - within their domain, agents decide

## Key Principles

1. **Plans provide structure, not code** - Planner describes WHAT/WHY, Implementer decides HOW
2. **Test strategy, not test cases** - QA defines expectations, Implementer creates actual tests
3. **Sequential quality gates** - QA validates technical quality before Reviewer validates business value
4. **Critic review is mandatory** - Plans must be reviewed before implementation begins
5. **Edit tools are scoped** - Each agent's edit capability is limited to their artifact directory
6. **QA creates tests proactively** - Don't wait for Implementer; QA can write comprehensive test scaffolding
7. **Implementer flags conflicts** - If plan and QA strategy conflict, pause and escalate (don't guess)
7. **Reviewer synthesizes release decision** - After QA + UAT complete, explicit APPROVED FOR RELEASE decision
8. **DevOps requires user confirmation** - Presents release summary and waits for explicit approval before deploying
9. **Retrospective captures learning** - After deployment, document lessons learned for future work

## Process Improvements

The agent system continuously improves through:
- **Critique revision histories** - Track how plans evolve through feedback cycles
- **Escalation pattern analysis** - Identify recurring issues needing systemic fixes
- **Retrospective insights** - Learn from completed work to improve future planning
- **Architectural audits** - Periodically review codebase health and technical debt

## Getting Started

1. **User provides objective** - Describe what you want to achieve
2. **Planner creates plan** - Translates objective into implementation plan with value statement
3. **Critic reviews plan** - Validates quality, flags issues, approves or requests revision
4. **Implementer executes** - Writes code following approved plan
5. **QA validates quality** - Tests coverage and execution
6. **Reviewer validates value** - Confirms business objective achieved, issues APPROVED FOR RELEASE
7. **DevOps prepares release** - Verifies packaging, requests user confirmation, executes deployment
8. **Retrospective captures lessons** - Documents insights for future work

---

**Note**: This workflow balances structure with flexibility. Agents have clear responsibilities but can invoke each other as needed. The goal is high-quality software delivery through collaborative, structured work.
