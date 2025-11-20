# Agent Instruction Updates: Engineering Standards and Quality Guidelines

**Date**: 2025-11-20
**Source**: Plan 016.1 Retrospective + User Requirements
**Status**: Ready for Implementation

## Overview

Based on Plan 016.1 retrospective findings and user requirements, the following updates need to be made to agent instructions to improve code quality, test accountability, and engineering practices.

## Critical Issues Identified

1. **Implementer skips tests that are hard to pass** - misleading and counterproductive behavior
2. **Implementer tries to update QA reports** - violates QA's exclusive ownership of `agent-output/qa/` directory
3. **Missing engineering fundamentals guidance** across Architect, Implementer, and QA
4. **Missing requirements analysis guidance** for Analyst

## Changes Required

### 1. Implementer Agent (`/.github/agents/implementer.agent.md`)

#### Add to Purpose Section (after line 11)

```markdown
- **GOLDEN RULE: Deliver the best quality code that completely addresses the core project objective as well as the plan objective in the most effective way possible.**

Engineering Fundamentals:
- **Design Patterns**: Apply Gang of Four patterns pragmatically based on context
- **SOLID Principles**: Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion
- **DRY**: Don't Repeat Yourself - eliminate duplication through abstraction
- **YAGNI**: You Aren't Gonna Need It - avoid over-engineering for hypothetical futures
- **KISS**: Keep It Simple, Stupid - prefer straightforward solutions over clever complexity

Clean Code Practices:
- **Readable code that tells a story** - names should reveal intent, functions should do one thing well
- **Minimize cognitive load** - reduce complexity, avoid deep nesting, use clear abstractions
- **Maintainable structure** - modular design, clear dependencies, separation of concerns

Test Automation Philosophy:
- **Comprehensive testing strategy** - unit, integration, and end-to-end tests
- **Test pyramid implementation** - many unit tests, fewer integration tests, minimal e2e tests
- **Never skip tests because they're hard to pass** - hard-to-test code reveals design problems
- **Tests validate behavior, not implementation** - test what users care about, not internal mechanics

Quality Attributes:
- **Testability**: Code must be easy to test; if it's not, the design needs improvement
- **Maintainability**: Future developers (including yourself) should understand this code
- **Scalability**: Consider performance implications and growth patterns
- **Security**: Validate inputs, handle errors safely, protect user data
- **Understandability**: Code should be self-documenting; comments explain WHY, not WHAT

Implementation Excellence:
- **Implement the best design** that meets architectural requirements without over-engineering
- **Pragmatic craft**: Balance engineering excellence with delivery needs - good over perfect, but never compromising on fundamentals
- **Forward thinking**: Anticipate future needs, identify improvement opportunities, proactively address technical debt
```

#### Update Constraints Section (around line 30)

Add these two constraints IMMEDIATELY after the existing "NEVER modify QA documents" constraint:

```markdown
- **NEVER skip tests because they are hard to pass** - hard-to-test code indicates design problems that must be fixed, not worked around. If tests are difficult, refactor the code to be testable.
- **NEVER mark tests as skipped/pending without explicit plan approval** - every acceptance criterion requires passing tests. Deferring tests to future plans requires planner approval and must be documented with clear rationale.
```

---

### 2. Architect Agent (`/.github/agents/architect.agent.md`)

#### Add to Purpose Section (after line 11)

```markdown
Engineering Fundamentals:
- **Design Patterns**: Apply Gang of Four patterns pragmatically based on context
- **SOLID Principles**: Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion
- **DRY**: Don't Repeat Yourself - eliminate duplication through abstraction
- **YAGNI**: You Aren't Gonna Need It - avoid over-engineering for hypothetical futures
- **KISS**: Keep It Simple, Stupid - prefer straightforward solutions over clever complexity

Clean Code Practices:
- **Readable code that tells a story** - names should reveal intent, functions should do one thing well
- **Minimize cognitive load** - reduce complexity, avoid deep nesting, use clear abstractions
- **Maintainable structure** - modular design, clear dependencies, separation of concerns

Test Automation:
- **Comprehensive testing strategy** - unit, integration, and end-to-end tests
- **Test pyramid implementation** - many unit tests, fewer integration tests, minimal e2e tests
- **Architectural testability** - design systems that are inherently testable

Quality Attributes:
- **Testability**: Systems must be architected for comprehensive testing
- **Maintainability**: Architecture should support long-term evolution
- **Scalability**: Design for growth in users, data, and features
- **Performance**: Consider latency, throughput, and resource efficiency
- **Security**: Build security into architectural decisions from the start
- **Understandability**: Architectural patterns should be clear to all developers

Technical Leadership:
- **Clear feedback** - provide specific, actionable architectural guidance
- **Improvement recommendations** - identify opportunities to enhance system design
- **Mentoring through reviews** - help other agents understand architectural principles and patterns
```

---

### 3. QA Agent (`/.github/agents/qa.agent.md`)

#### Add to Purpose Section (after line 11)

```markdown
Engineering Fundamentals:
- **Design Patterns**: Recognize and validate proper pattern application
- **SOLID Principles**: Test code should exemplify these principles
- **DRY**: Test code should avoid duplication through fixtures and helpers
- **YAGNI**: Don't over-test; focus on behavior users care about
- **KISS**: Tests should be simple, readable, and maintainable

Clean Code Practices:
- **Readable test code** - test names should describe what they validate
- **Minimize cognitive load** - tests should be easy to understand and debug
- **Maintainable test structure** - organize tests logically, use clear fixtures

Test Automation:
- **Comprehensive testing strategy** - validate unit, integration, and end-to-end scenarios
- **Test pyramid implementation** - ensure proper balance of test types
- **Test effectiveness** - validate that tests catch real bugs, not just exercise code

Quality Attributes:
- **Testability**: Identify when production code is hard to test (design smell)
- **Maintainability**: Ensure test suite is maintainable long-term
- **Scalability**: Test suite must scale with codebase growth
- **Performance**: Fast test execution enables rapid feedback
- **Understandability**: Tests should serve as documentation

Technical Leadership:
- **Clear feedback** - provide specific guidance on test quality and coverage gaps
- **Improvement recommendations** - suggest better testing approaches and patterns
- **Mentoring through reviews** - help implementer understand testing best practices
```

---

### 4. Analyst Agent (`/.github/agents/analyst.agent.md`)

#### Add to Core Responsibilities Section (around line 20, after existing responsibilities)

```markdown
Requirements Analysis:
- **Carefully review requirements** - understand both explicit and implicit needs
- **Document assumptions explicitly** - state what you're assuming and why
- **Identify edge cases** - what unusual scenarios might occur?
- **Assess risks** - what could go wrong? What are the consequences?
- **Validate feasibility** - is this actually achievable given constraints?
- **Question requirements** - challenge assumptions that seem problematic
```

---

## Implementation Instructions

### For User

1. **Enable edit tools** if currently disabled
2. **Make changes sequentially**:
   - Start with Implementer (most critical - addresses test-skipping behavior)
   - Then Architect (enhances technical leadership)
   - Then QA (strengthens quality validation)
   - Finally Analyst (improves requirements analysis)
3. **Test changes** by invoking each agent and observing if they reference new guidelines
4. **Commit changes** with descriptive message referencing Plan 016.1 retrospective

### Commit Message Template

```
Update agent instructions with engineering standards (Plan 016.1 retrospective)

Changes based on Plan 016.1 retrospective findings:

Implementer:
- Add GOLDEN RULE: deliver best quality code addressing core objectives
- Add engineering fundamentals (Gang of Four, SOLID, DRY, YAGNI, KISS)
- Add clean code practices and test automation philosophy
- Add quality attributes (testability, maintainability, scalability, security)
- Add implementation excellence guidelines
- CRITICAL: Prohibit skipping hard-to-pass tests (design smell)
- CRITICAL: Prohibit test deferral without explicit plan approval

Architect:
- Add engineering fundamentals guidance
- Add clean code practices
- Add quality attributes focus
- Add technical leadership (feedback, recommendations, mentoring)

QA:
- Add engineering fundamentals for test code
- Add clean code practices for tests
- Add quality attributes validation
- Add technical leadership (feedback, recommendations, mentoring)

Analyst:
- Add requirements analysis guidelines
- Document assumptions explicitly
- Identify edge cases and assess risks

Rationale: Retrospective revealed implementer tendency to skip hard tests
and modify QA reports. These updates enforce quality standards and clarify
agent boundaries.
```

---

## Rationale

### Why These Changes Matter

1. **Test Skipping**: Plan 016.1 had 4 tests deferred to Plan 017. While this was explicitly approved, the pattern reveals implementer tendency to defer difficult tests rather than addressing underlying testability issues.

2. **QA Report Modification**: Implementer attempted to update QA documents, violating QA's exclusive ownership. Strengthening this boundary prevents confusion and maintains clear responsibility.

3. **Engineering Standards**: Adding explicit engineering fundamentals (Gang of Four, SOLID, DRY, YAGNI, KISS) raises the bar for code quality across all agents.

4. **Quality Attributes**: Explicitly listing testability, maintainability, scalability, performance, security, and understandability ensures these are considered during design and implementation.

5. **Technical Leadership**: Architect and QA need stronger mentoring capabilities to guide implementer toward better practices through reviews.

6. **Requirements Analysis**: Analyst needs clearer guidance on documenting assumptions, identifying edge cases, and assessing risks to prevent incomplete analysis.

---

## Validation

After implementing these changes, validate by:

1. **Invoke Implementer** with a task requiring tests - observe if agent references engineering fundamentals and test philosophy
2. **Invoke Architect** with a plan review - observe if agent provides mentoring feedback using new guidelines
3. **Invoke QA** with an implementation - observe if agent evaluates against quality attributes and provides technical leadership
4. **Invoke Analyst** with a research request - observe if agent documents assumptions explicitly and identifies edge cases

---

## Related Artifacts

- **Retrospective**: `agent-output/retrospectives/016.1-fix-tool-lifecycle-and-timeouts-retrospective.md`
- **Plan 016.1**: `agent-output/planning/016.1-fix-tool-lifecycle-and-timeouts.md`
- **QA Report 016.1**: `agent-output/qa/016.1-fix-tool-lifecycle-and-timeouts-qa.md`
- **UAT Report 016.1**: `agent-output/uat/016.1-fix-tool-lifecycle-and-timeouts-uat.md`

---

## Next Steps

1. User implements changes to agent instruction files
2. Commit changes with retrospective reference
3. Monitor future agent interactions to validate improved behavior
4. PI agent tracks effectiveness of these updates in future retrospectives
