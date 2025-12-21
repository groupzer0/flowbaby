# Refactoring Catalog

Quick reference for common refactoring techniques.

## Extract Method
**When:** Code block can be grouped with descriptive name
```
# Before
def process():
    # validate input
    if not x: raise Error
    if not y: raise Error
    # do work
    result = complex_operation()

# After
def process():
    validate_input(x, y)
    result = complex_operation()

def validate_input(x, y):
    if not x: raise Error
    if not y: raise Error
```

## Extract Class
**When:** Class has multiple responsibilities
```
# Before
class Order:
    def calculate_total(self): ...
    def format_invoice(self): ...
    def send_email(self): ...

# After
class Order:
    def calculate_total(self): ...

class InvoiceFormatter:
    def format(self, order): ...

class OrderNotifier:
    def send_email(self, order): ...
```

## Replace Conditional with Polymorphism
**When:** Switch/case on type
```
# Before
def calculate_pay(employee):
    if employee.type == "hourly":
        return hours * rate
    elif employee.type == "salary":
        return annual / 12

# After
class HourlyEmployee:
    def calculate_pay(self):
        return self.hours * self.rate

class SalariedEmployee:
    def calculate_pay(self):
        return self.annual / 12
```

## Introduce Parameter Object
**When:** Same parameters appear together
```
# Before
def search(start_date, end_date, min_price, max_price): ...

# After
@dataclass
class SearchCriteria:
    start_date: date
    end_date: date
    min_price: float
    max_price: float

def search(criteria: SearchCriteria): ...
```

## Replace Magic Number with Constant
**When:** Literal values with meaning
```
# Before
if velocity > 343: return "supersonic"

# After
SPEED_OF_SOUND_MPS = 343
if velocity > SPEED_OF_SOUND_MPS: return "supersonic"
```

## Guard Clause (Replace Nested Conditional)
**When:** Deep nesting obscures logic
```
# Before
def process(x):
    if x:
        if x.valid:
            if x.ready:
                return do_work(x)
    return None

# After
def process(x):
    if not x: return None
    if not x.valid: return None
    if not x.ready: return None
    return do_work(x)
```
