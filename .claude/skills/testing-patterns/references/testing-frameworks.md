# Testing Framework Quick Reference

## JavaScript/TypeScript

### Jest
```javascript
// Test
test('calculates total with discount', () => {
  expect(calculateTotal(100, 0.2)).toBe(80);
});

// Mock
jest.mock('./emailService');
const emailService = require('./emailService');
emailService.send.mockResolvedValue({ success: true });

// Async
test('fetches user', async () => {
  const user = await fetchUser(1);
  expect(user.name).toBe('Alice');
});
```

### Vitest
```javascript
import { describe, it, expect, vi } from 'vitest';

it('works like jest', () => {
  const spy = vi.fn();
  spy('hello');
  expect(spy).toHaveBeenCalledWith('hello');
});
```

## Python

### pytest
```python
# Test
def test_calculate_total():
    assert calculate_total(100, 0.2) == 80

# Fixture
@pytest.fixture
def db():
    db = create_test_db()
    yield db
    db.cleanup()

def test_user_repo(db):
    repo = UserRepo(db)
    ...

# Mock
def test_sends_email(mocker):
    mock_send = mocker.patch('app.email.send')
    complete_order()
    mock_send.assert_called_once()

# Parametrize
@pytest.mark.parametrize("input,expected", [
    (0, 0),
    (100, 80),
    (-1, ValueError),
])
def test_discount(input, expected):
    ...
```

## Java

### JUnit 5
```java
@Test
void calculatesTotal() {
    assertEquals(80, Order.calculateTotal(100, 0.2));
}

@ParameterizedTest
@ValueSource(ints = {0, -1, 1000000})
void handlesEdgeCases(int value) {
    ...
}

// Mock with Mockito
@ExtendWith(MockitoExtension.class)
class OrderTest {
    @Mock EmailService emailService;
    @InjectMocks OrderService orderService;
    
    @Test
    void sendsConfirmation() {
        orderService.complete(order);
        verify(emailService).send(any(Email.class));
    }
}
```

## Go

### testing package
```go
func TestCalculateTotal(t *testing.T) {
    got := CalculateTotal(100, 0.2)
    want := 80.0
    if got != want {
        t.Errorf("got %f, want %f", got, want)
    }
}

// Table-driven
func TestDiscount(t *testing.T) {
    tests := []struct {
        name     string
        price    float64
        discount float64
        want     float64
    }{
        {"no discount", 100, 0, 100},
        {"20% off", 100, 0.2, 80},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got := ApplyDiscount(tt.price, tt.discount)
            if got != tt.want {
                t.Errorf("got %f, want %f", got, tt.want)
            }
        })
    }
}
```

## VS Code Extension Testing

```typescript
import * as vscode from 'vscode';
import * as assert from 'assert';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start tests');

    test('activates extension', async () => {
        const ext = vscode.extensions.getExtension('publisher.extension');
        await ext?.activate();
        assert.ok(ext?.isActive);
    });

    test('registers commands', async () => {
        const commands = await vscode.commands.getCommands();
        assert.ok(commands.includes('extension.myCommand'));
    });
});
```
