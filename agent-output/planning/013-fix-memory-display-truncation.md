# Plan 013: Fix Memory Display Truncation in Chat Participant

**Plan ID**: 013  
**Epic Reference**: Roadmap Epic 0.2.2.3 (Feature Discoverability and Onboarding UX)  
**Created**: 2025-11-16  
**Status**: Proposed  
**Owner**: planner → critic → implementer

---

## Value Statement and Business Objective

**As a developer using @cognee-memory chat participant,**  
**I want to see the full retrieved memory content in the chat window,**  
**So that I understand what context the system found and can trust the information being used to answer my questions.**

**As a developer using @cognee-memory chat participant,**  
**I want to be sure that my complete query text is being sent to Cognee for search,**  
**So that my search returns the most relevant results.**

**Alignment with Master Product Objective**: The Master Product Objective emphasizes "Zero Cognitive Overhead" and "Natural Language Retrieval." When retrieved memories are truncated to 150 characters in the chat window, users cannot verify what context the system found, creating confusion and eroding trust. Users must guess whether truncation removed critical information, adding cognitive burden rather than eliminating it.

---

## Objective

Fix display truncation in the @cognee-memory chat participant so users can see complete retrieved memory content and verify that full query text is being sent to Cognee's search API.

---

## Context and Background

### Current Behavior

When users invoke `@cognee-memory` with a query:

1. **Query Truncation in Logs**: The user's query appears truncated in Output channel logs (e.g., `"What is the direct command line i could use to ing"` instead of full query)
2. **Memory Display Truncation**: Retrieved memories are truncated to 150 characters in the chat window with `...` ellipsis
3. **User Confusion**: Users see:
   ```
   📚 Retrieved 1 memory
   
   Memory 1:
   > To ingest information into Cognee Memory, use the following command line:
   
   `python extension/bridge/ingest.py <workspace_path> <user_message> <assist...
   ```

### Root Cause Analysis

**Issue 1: Memory Display Truncation** (User-Facing Problem)

- **Location**: `extension/src/extension.ts` line 268-270
- **Code**:
  ```typescript
  const preview = memory.length > 150 
      ? memory.substring(0, 150) + '...' 
      : memory;
  ```
- **Impact**: Users cannot see full retrieved context, breaking trust and transparency

**Issue 2: Query Preview Truncation in Logs** (Logging Only)

- **Location**: `extension/src/cogneeClient.ts` lines 289, 324
- **Code**: `query_preview: query.substring(0, 50)`
- **Impact**: Logs show truncated query, but **full query is correctly passed** to `retrieve.py` via `args` array
- **Verification**: Line 299 passes full `query` string to Python subprocess without truncation

**Issue 3: Stdout Buffer Limit** (Not Currently Affecting Results)

- **Location**: `extension/src/cogneeClient.ts` line 450-452
- **Code**: Stdout truncated to 2KB during collection
- **Current Impact**: Low risk for retrieval (JSON responses typically <2KB with 3-5 results), but could affect ingestion with large responses
- **Recommendation**: analyst should investigate if this limit could cause issues with larger result sets

### What's Working Correctly

✅ **Query is NOT truncated when sent to Cognee** - The full query string is passed as `sys.argv[2]` to `retrieve.py` without any length limit  
✅ **Retrieval receives complete query** - Python bridge correctly uses full query for `cognee.search()`  
✅ **Full memories are retrieved** - The augmented prompt (line 281) uses complete `memory` text, not the truncated preview

### What Needs Fixing

❌ **Display truncation** - Users see only 150 chars of retrieved memories in chat window  
❌ **Log preview truncation** - Output channel shows only 50 chars of query (cosmetic issue, but confusing for debugging)

---

## Assumptions

1. Retrieved memory content averaging 200-500 characters per result is reasonable to display in chat window
2. Users benefit from seeing complete context rather than truncated previews
3. VS Code chat participant can render longer markdown blocks without performance issues
4. Stdout 2KB buffer limit is sufficient for typical retrieval responses (3-5 results × ~500 chars = ~2.5KB, near limit but manageable)

---

## Open Questions for Analyst

**QUESTION 1**: What is the maximum practical length for displaying retrieved memories in VS Code chat participant before performance degrades?

- **Context**: Currently truncated at 150 chars; full memories might be 500-2000 chars each
- **Options**: (a) Display full memory with no limit, (b) Increase limit to 500-1000 chars, (c) Add "Show More" interaction pattern
- **Decision Driver**: User trust vs chat window scrolling UX

**QUESTION 2**: Should we increase the stdout buffer limit (currently 2KB) to handle larger retrieval result sets?

- **Context**: With 5 results × 500 chars each = 2.5KB JSON payload, we're near the limit
- **Risk**: If Cognee returns verbose metadata or users increase `max_results`, responses could be truncated silently
- **Options**: (a) Increase to 10KB, (b) Make buffer size configurable, (c) Add streaming JSON parsing
- **Decision Driver**: Robustness vs memory usage

**QUESTION 3**: Are there VS Code API limits or best practices for chat participant response length?

- **Context**: We need to understand if displaying 2-5 memories of 500-1000 chars each could cause issues
- **Research**: Check VS Code Chat API documentation and best practices

---

## Plan

### Milestone 1: Fix Memory Display Truncation (User-Facing)

**Objective**: Allow users to see complete retrieved memory content in chat window

**Steps**:

1. Remove or significantly increase the 150-character truncation limit in `extension/src/extension.ts` (line 268-270)
2. Test display with various memory lengths (200, 500, 1000, 2000 characters) to verify UX
3. Consider adding configurable limit via `cogneeMemory.maxMemoryPreviewLength` setting if full display causes issues
4. Update user-facing preview to indicate total memory length (e.g., `Memory 1 (487 chars):`)

**Acceptance Criteria**:
- Users see complete retrieved memory content in chat window (up to reasonable limit, e.g., 2000 chars)
- If memory exceeds display limit, show clear indication (e.g., "... (showing 2000 of 3500 chars)")
- Chat window remains scrollable and performant with 3-5 full memories displayed

### Milestone 2: Improve Query Logging (Debugging UX)

**Objective**: Show full query text in Output channel logs for better debugging

**Steps**:

1. Increase `query_preview` truncation from 50 to 200 characters in `extension/src/cogneeClient.ts` (lines 289, 324)
2. Alternatively, log full query without truncation since it's already in Output channel (not user-facing UI)
3. Add indication of truncation if query exceeds logging limit (e.g., `query_preview: "long query..." (387 chars total)`)

**Acceptance Criteria**:
- Output channel logs show enough query text to understand user's intent (200+ chars)
- Logs indicate total query length if truncated
- Log format remains structured and readable

### Milestone 3: (Optional) Increase Stdout Buffer Limit

**Objective**: Prevent silent truncation of large retrieval responses

**Conditional on analyst findings** - only proceed if analyst confirms risk of truncation with typical usage patterns

**Steps**:

1. Increase stdout buffer limit from 2KB to 10KB in `extension/src/cogneeClient.ts` (line 450-452)
2. Add warning log if stdout approaches buffer limit before truncation
3. Test with max_results=10 to verify larger responses are handled correctly

**Acceptance Criteria**:
- Retrieval responses with 5-10 results (up to ~5KB JSON) are not truncated
- Warning logged if response size exceeds 80% of buffer limit
- Memory usage remains reasonable (10KB per subprocess call is acceptable)

---

## Testing Strategy

**Unit Testing**:
- Test memory display with various content lengths (100, 500, 1000, 2000 chars)
- Verify query logging shows sufficient context for debugging
- Test stdout buffer behavior with large mock responses

**Integration Testing**:
- Test @cognee-memory participant with real retrieved memories of varying lengths
- Verify full memories are displayed in chat window
- Verify augmented prompt (sent to LLM) contains complete memory text

**Manual Testing**:
- Ingest conversation with long assistant response (500+ chars)
- Retrieve using @cognee-memory and verify full content visible
- Check Output channel logs show complete query text
- Test with 5-10 retrieved memories to verify scrolling UX

**Edge Cases**:
- Very long query (500+ chars) - verify full query sent to Cognee
- Very long memory (2000+ chars) - verify display is readable or appropriately truncated with indication
- Multiple long memories (5 results × 1000 chars each) - verify chat window remains performant

---

## Validation

### Definition of Done

- [ ] Retrieved memories displayed without arbitrary 150-char truncation
- [ ] Users can see complete memory content in chat window (up to reasonable limit)
- [ ] Output channel logs show sufficient query text for debugging (200+ chars)
- [ ] If truncation is necessary, clear indication shown (e.g., "... (showing 2000 of 3500 chars)")
- [ ] Existing tests pass (npm test, pytest)
- [ ] Manual testing confirms UX improvement
- [ ] No performance regression in chat participant response time

### Success Metrics

- Users report increased trust in retrieved context ("I can see what the system found")
- Support requests about "truncated results" eliminated
- Output channel logs provide sufficient debugging context without manual query reconstruction

---

## Risks and Mitigations

**Risk 1: Very Long Memories Cause Chat Window Scrolling Issues**

- **Likelihood**: Medium
- **Impact**: Medium (poor UX, not functional failure)
- **Mitigation**: Add configurable `maxMemoryPreviewLength` setting (default 2000 chars) with clear truncation indication
- **Fallback**: Revert to 500-char limit if full display causes issues

**Risk 2: Stdout Buffer Limit Silently Truncates Large Responses**

- **Likelihood**: Low (typical responses <2KB)
- **Impact**: High (silent data loss, user confusion)
- **Mitigation**: analyst investigates realistic response sizes; increase buffer if needed; add warning logs
- **Fallback**: Document known limitation in CHANGELOG if buffer increase not feasible

**Risk 3: Performance Degradation with Many Long Memories**

- **Likelihood**: Low
- **Impact**: Medium
- **Mitigation**: Test with 10 memories × 1000 chars each; monitor response time
- **Fallback**: Limit `max_results` default or add pagination if performance suffers

---

## Dependencies

### Upstream Dependencies

- None (plan can proceed independently)

### Downstream Dependencies

- **Analyst** (optional): Investigate stdout buffer sizing and VS Code chat API limits before Milestone 3
- **QA**: Validate display UX with various memory lengths and verify no performance regression
- **Critic**: Review plan for architectural alignment and scope appropriateness

---

## Rollback Plan

If implementation causes issues:

1. **Immediate**: Revert to 150-char truncation via configuration setting
2. **Short-term**: Add `cogneeMemory.maxMemoryPreviewLength` setting (default 500 or 1000)
3. **Long-term**: Implement progressive disclosure (e.g., "Show Full Memory" button) if static display limit insufficient

---

## Notes

- **Query truncation is NOT a bug** - Full query is correctly sent to Cognee; only logging shows truncated preview
- **Focus on user-facing display** - Memory truncation is the primary UX issue blocking trust and transparency
- **Stdout buffer is a secondary concern** - analyst should investigate before implementing Milestone 3
- **Aligns with Epic 0.2.2.3** - Feature discoverability and transparency are foundational to user trust

---

## Related Documents

- **Epic**: `agent-output/roadmap/product-roadmap.md` - Epic 0.2.2.3 (Feature Discoverability and Onboarding UX)
- **Architecture**: `agent-output/architecture/system-architecture.md` - Section 4.3 (Retrieval / Chat Participant Flow)
- **Implementation**: To be created as `agent-output/implementation/013-fix-memory-display-truncation-implementation.md`
- **QA**: To be created as `agent-output/qa/013-fix-memory-display-truncation-qa.md`
