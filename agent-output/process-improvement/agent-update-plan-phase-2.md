# Agent Instruction Update Plan - Phase 2

**Status**: Ready for implementation
**Scope**: Add engineering standards to 8 agents, apply RFC 2119, reduce verbosity

---

## Changes to Implement

### 1. Add Engineering Fundamentals to Missing Agents

**Planner** - Add after Purpose section:
```markdown
**Engineering Standards for Planning**:
- **Design Patterns**: Plans SHOULD reference established patterns (Gang of Four, SOLID principles, DRY, YAGNI, KISS) when setting implementation expectations
- **Quality Attributes**: Plans MUST specify testability, maintainability, scalability, performance, security requirements where applicable
- **Clean Code**: Expect readable, maintainable code; call out areas requiring extra clarity
```

**Critic** - Add after Purpose section:
```markdown
**Engineering Standards for Review**:
- **Design Patterns**: Evaluate whether plan guidance aligns with Gang of Four patterns, SOLID principles, DRY, YAGNI, KISS
- **Quality Attributes**: Verify plan addresses testability, maintainability, scalability, performance, security
- **Architectural Coherence**: Ensure plan respects clean code practices and minimizes cognitive load
```

**UAT** - Add after Purpose section:
```markdown
**Engineering Standards for Validation**:
- **Quality Attributes**: Validate delivered code demonstrates testability, maintainability, scalability, performance, security
- **Clean Code**: Assess whether implementation is readable and maintainable for future developers
- **Test Automation**: Verify comprehensive test coverage supports long-term maintenance
```

**DevOps** - Add after Purpose section:
```markdown
**Engineering Standards for Deployment**:
- **Quality Attributes**: Verify package demonstrates security (no exposed credentials), performance (reasonable size), maintainability (clear versioning)
- **Clean Packaging**: Ensure deployment artifacts follow clean code principles (no bloat, clear dependencies, proper .ignore patterns)
```

**Roadmap** - Add after Purpose section:
```markdown
**Engineering Standards for Strategy**:
- **Quality Attributes**: Epics SHOULD specify expected quality attributes (testability, maintainability, scalability, performance, security, understandability)
- **Architectural Alignment**: Strategic decisions MUST enable clean code practices and sustainable engineering
```

**Escalation** - Add after Purpose section:
```markdown
**Engineering Standards for Decisions**:
- **Quality Attributes**: Decisions MUST weigh trade-offs between testability, maintainability, scalability, performance, security
- **Technical Debt**: Assess whether accepting technical debt violates SOLID principles or creates unsustainable burden
```

**Retrospective** - Add after Purpose section:
```markdown
**Engineering Standards for Review**:
- **Process Quality**: Assess whether workflow supports clean code practices, test automation, and quality attributes
- **Pattern Recognition**: Identify where engineering fundamentals (Gang of Four, SOLID, DRY, YAGNI, KISS) improved or harmed outcomes
```

**PI** - Add after Purpose section:
```markdown
**Engineering Standards for Process Improvement**:
- **Quality Attributes**: Process changes MUST support testability, maintainability, scalability
- **Sustainable Practices**: Improvements SHOULD align with engineering fundamentals (SOLID, DRY, YAGNI, KISS)
```

---

### 2. RFC 2119 Keyword Applications

**Critical MUST statements**:
- Implementer: "MUST read plan in full" (already done)
- QA: "Tests MUST expose real user-facing failures" (already done)
- UAT: "MUST validate alignment with Master Product Objective"
- All: "MUST read roadmap and architecture docs"

**Critical MUST NOT statements**:
- Implementer: "MUST NOT skip tests because they're hard" (already done)
- Implementer: "MUST NOT modify QA documents" (already done)
- Roadmap: "MUST NOT modify Master Product Objective"
- All: "MUST NOT proceed without required artifacts"

**SHOULD statements** (strong recommendation):
- Analyst: "SHOULD consult Architect early"
- QA: "SHOULD consult Architect when designing test strategy"
- Planner: "SHOULD create measurable success criteria"

**MAY statements** (optional):
- All: "MAY escalate to Escalation agent"
- Analyst: "MAY skip Architect consultation for simple API checks"

---

### 3. Verbosity Reduction Targets

**Planner**: 
- Lines 110-180 (version management) → Reference devops guidance (save 50 lines)
- Response style consolidation (save 10 lines)

**UAT**:
- Consolidate "objective drift" repetitions (currently 8 mentions) → single clear section (save 20 lines)

**Critic**:
- Consolidate "no code in plans" repetition (currently 4 mentions) → state once clearly (save 25 lines)

**All agents**:
- Agent workflow section → streamline to interaction-specific content only (save 200 lines total)

---

### 4. Escalation Framework Addition

Add to all agents before "Escalation:" section:

```markdown
**Escalation Framework** (see TERMINOLOGY.md):
- **IMMEDIATE** (1 hour): Blocking issue prevents all progress
- **SAME-DAY** (4 hours): Agent conflict, value undeliverable, architectural misalignment
- **PLAN-LEVEL**: Scope larger than estimated, acceptance criteria unverifiable
- **PATTERN**: Same issue recurring 3+ times indicating process failure
```

---

### 5. Passive Voice Reduction

**Examples**:
- "Plans should be guided by" → "Guide plans with"
- "Tests must be executed by" → "Execute tests using"
- "Documentation will be created in" → "Create documentation in"
- "Analysis should be performed" → "Perform analysis"
- "Decisions are made by" → "Make decisions"

**Target savings**: 500-800 words across all files

---

## Implementation Priority

1. ✅ DONE: Fix numbering errors (Analyst, QA)
2. HIGH: Add engineering standards to 8 missing agents
3. HIGH: Apply critical MUST/MUST NOT statements
4. MEDIUM: Add escalation framework
5. MEDIUM: Reduce verbosity in top 3 targets (Planner, UAT, Critic)
6. LOW: Passive voice reduction (time-intensive, lower impact)

---

## Risk Assessment

**LOW RISK**:
- Adding engineering standards (additive, doesn't change behavior)
- Fixing numbering errors (correctness fix)
- Adding escalation framework (clarifies existing practice)

**MEDIUM RISK**:
- Applying RFC 2119 keywords (changes tone, but improves clarity)
- Verbosity reduction (must preserve all meaning)

**HIGH RISK**:
- None in this plan

**Recommendation**: Proceed with HIGH and MEDIUM priority items. LOW priority passive voice reduction can be deferred.
