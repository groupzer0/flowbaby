# Python Vulnerabilities

## Code Execution
```python
# VULNERABLE - arbitrary code execution
eval(user_input)
exec(user_input)
compile(user_input, '<string>', 'exec')

# SAFE - use ast.literal_eval for data only
import ast
data = ast.literal_eval(user_input)  # Only literals
```

## Unsafe Deserialization
```python
# VULNERABLE - can execute code
import pickle
obj = pickle.loads(user_data)

import yaml
data = yaml.load(user_input)  # Unsafe loader

# SAFE
import json
data = json.loads(user_input)

import yaml
data = yaml.safe_load(user_input)
```

## SQL Injection
```python
# VULNERABLE
cursor.execute(f"SELECT * FROM users WHERE id = {user_id}")
cursor.execute("SELECT * FROM users WHERE id = " + user_id)

# SAFE - parameterized queries
cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))
cursor.execute("SELECT * FROM users WHERE id = :id", {"id": user_id})

# ORM (Django)
User.objects.filter(id=user_id)  # Safe
User.objects.raw(f"SELECT * FROM ... {user_id}")  # VULNERABLE
```

## Command Injection
```python
# VULNERABLE
os.system(f"convert {filename}")
subprocess.call(f"convert {filename}", shell=True)

# SAFE
subprocess.run(["convert", filename], shell=False)
shlex.quote(filename)  # If shell=True is required
```

## Path Traversal
```python
# VULNERABLE
path = os.path.join(UPLOAD_DIR, user_filename)
open(path).read()

# SAFE
import pathlib
base = pathlib.Path(UPLOAD_DIR).resolve()
target = (base / user_filename).resolve()
if not str(target).startswith(str(base)):
    raise ValueError("Path traversal detected")
```

## Flask/Django Issues
```python
# VULNERABLE - XSS in Flask
return f"<h1>{user_input}</h1>"

# SAFE - auto-escaping
return render_template("page.html", name=user_input)

# VULNERABLE - CSRF disabled
@csrf_exempt  # Only when absolutely necessary
def view(request): ...

# Django CORS misconfiguration
CORS_ALLOW_ALL_ORIGINS = True  # VULNERABLE
CORS_ALLOWED_ORIGINS = ["https://example.com"]  # SAFE
```

## SSRF
```python
# VULNERABLE
import requests
response = requests.get(user_url)

# SAFE - validate URL
from urllib.parse import urlparse
parsed = urlparse(user_url)
if parsed.hostname not in ALLOWED_HOSTS:
    raise ValueError("Disallowed host")
if parsed.scheme not in ('http', 'https'):
    raise ValueError("Invalid scheme")
```
