---
name: testing-patterns
description: Test strategy patterns including test pyramid, coverage strategies, mocking approaches, and edge case generation. Load when designing test strategies, reviewing test coverage, or implementing test frameworks.
license: MIT
metadata:
  author: groupzer0
  version: "1.0"
---

# Testing Patterns

Systematic approach to effective testing. Use this skill when:
- Designing test strategies for new features
- Reviewing test coverage adequacy
- Implementing test frameworks or infrastructure
- Identifying missing test scenarios

## Test Pyramid

```
        /\
       /  \        E2E Tests (10%)
      /----\       Slow, expensive, few
     /      \
    /--------\     Integration Tests (20%)
   /          \    Medium speed, focused
  /------------\
 /              \  Unit Tests (70%)
/________________\ Fast, isolated, many
```

### Unit Tests
**What:** Test single function/class in isolation
**When:** All business logic, utilities, data transformations
**Speed:** Milliseconds
**Isolation:** Mock all dependencies

```python
# Good unit test
def test_calculate_discount():
    order = Order(items=[Item(price=100)])
    assert order.calculate_discount(0.2) == 80

# Bad: tests integration, not unit
def test_order_discount():
    db.create_order(...)  # Touches database
    api.apply_coupon(...)  # External call
```

### Integration Tests
**What:** Test component interactions
**When:** Database queries, API contracts, service boundaries
**Speed:** Seconds
**Isolation:** Real dependencies for component under test

```python
# Integration: tests DB interaction
def test_user_repository_finds_by_email():
    repo = UserRepository(test_db)
    repo.create(User(email="test@example.com"))
    found = repo.find_by_email("test@example.com")
    assert found.email == "test@example.com"
```

### E2E Tests
**What:** Test full user workflows
**When:** Critical paths, smoke tests, happy paths
**Speed:** Minutes
**Isolation:** None—tests complete system

```python
# E2E: tests full flow
def test_user_can_checkout():
    browser.goto("/")
    browser.login("user@example.com", "password")
    browser.add_to_cart("product-1")
    browser.checkout()
    assert browser.has_text("Order confirmed")
```

---

## Coverage Strategy

### What to Cover (Priority Order)

1. **Business logic** — revenue-impacting calculations
2. **Security boundaries** — auth, validation, access control
3. **Error paths** — exception handling, edge cases
4. **Integration points** — API contracts, DB queries
5. **Happy paths** — standard user workflows

### What NOT to Prioritize

- Getters/setters without logic
- Framework code (already tested)
- Third-party libraries
- One-time scripts
- UI layout (unless critical)

### Coverage Targets

| Type | Target | Notes |
|------|--------|-------|
| Unit | 80%+ | Focus on logic, not coverage number |
| Integration | Critical paths | Don't test every permutation |
| E2E | Happy paths only | 5-10 core scenarios |

---

## Edge Case Generation

### Systematic Approach

**For numeric inputs:**
- Zero
- Negative numbers
- Very large numbers (overflow)
- Floating point precision
- Boundary values (n-1, n, n+1)

**For string inputs:**
- Empty string
- Very long string
- Unicode/emoji
- Special characters
- Whitespace only
- SQL/HTML injection attempts

**For collections:**
- Empty
- Single element
- Many elements
- Duplicates
- null/undefined elements

**For dates:**
- Leap years
- Timezone boundaries
- DST transitions
- Far past/future
- Invalid dates

### Example Matrix

```markdown
| Input | Scenario | Expected |
|-------|----------|----------|
| price | 0 | Free item handling |
| price | -5 | Validation error |
| price | 999999.99 | Large number display |
| name | "" | Required field error |
| name | "a"*1000 | Truncation or error |
| email | "test" | Invalid format error |
```

---

## Mocking Patterns

### When to Mock

| Context | Mock? | Reason |
|---------|-------|--------|
| Unit tests | Always | Isolation |
| Integration tests | External services only | Test real integration |
| E2E tests | Never | Test real system |

### Mock vs Stub vs Spy

```python
# Stub: Returns canned response
payment_gateway = Mock()
payment_gateway.charge.return_value = {"status": "success"}

# Mock: Verifies interactions
email_service = Mock()
order.complete()
email_service.send.assert_called_once_with(
    to="user@example.com",
    subject="Order Confirmed"
)

# Spy: Wraps real implementation
real_logger = Logger()
spy_logger = Mock(wraps=real_logger)
# Calls real method but records calls
```

### Anti-Patterns

- **Over-mocking:** If you mock everything, you're testing mocks
- **Mock pollution:** Mocks leaking between tests
- **Implementation testing:** Testing that method A calls method B
- **Fragile mocks:** Tests break when unrelated code changes

---

## Test Quality Checklist

| Quality | Check |
|---------|-------|
| **Readable** | Can a new dev understand in 30 seconds? |
| **Isolated** | Does it fail independently of other tests? |
| **Fast** | Unit tests < 100ms, Integration < 5s? |
| **Deterministic** | Same result every run? |
| **Focused** | One assertion per test (or logical group)? |
| **Maintainable** | Will this break for wrong reasons? |

---

## Test Naming

```
test_[unit]_[scenario]_[expected]

test_calculateDiscount_withExpiredCoupon_returnsZero
test_userRepository_findByEmail_whenNotFound_returnsNone
test_checkout_withEmptyCart_showsError
```

See [references/testing-frameworks.md](references/testing-frameworks.md) for framework-specific guidance.
