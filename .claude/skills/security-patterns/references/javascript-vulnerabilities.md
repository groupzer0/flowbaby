# JavaScript/TypeScript Vulnerabilities

## DOM-Based XSS
**Dangerous sinks:**
```javascript
// Never use with untrusted input
element.innerHTML = userInput;
element.outerHTML = userInput;
document.write(userInput);
eval(userInput);
new Function(userInput);
setTimeout(userInput, 0);
setInterval(userInput, 0);
```

**React-specific:**
```jsx
// Dangerous - allows XSS
<div dangerouslySetInnerHTML={{__html: userInput}} />

// Safe alternatives
<div>{userInput}</div>  // Auto-escaped
```

## SQL/NoSQL Injection
```javascript
// VULNERABLE
db.query(`SELECT * FROM users WHERE id = ${userId}`);
collection.find({ $where: `this.name == '${name}'` });

// SAFE
db.query('SELECT * FROM users WHERE id = ?', [userId]);
collection.find({ name: name });
```

## Command Injection
```javascript
// VULNERABLE
exec(`ls ${userInput}`);
spawn('sh', ['-c', `echo ${userInput}`]);

// SAFE
execFile('ls', [userInput]);  // No shell
spawn('echo', [userInput]);   // Array args
```

## Prototype Pollution
```javascript
// VULNERABLE - allows __proto__ modification
function merge(target, source) {
  for (let key in source) {
    target[key] = source[key];
  }
}

// SAFE - check for dangerous keys
function safeMerge(target, source) {
  for (let key in source) {
    if (key === '__proto__' || key === 'constructor') continue;
    if (!Object.hasOwn(source, key)) continue;
    target[key] = source[key];
  }
}
```

## Insecure Deserialization
```javascript
// VULNERABLE
const obj = JSON.parse(userInput);
obj.someMethod();  // Can execute if poisoned

// SAFE - validate structure
const parsed = JSON.parse(userInput);
const validated = schema.validate(parsed);
```

## JWT Issues
```javascript
// VULNERABLE - algorithm confusion
jwt.verify(token, secret);  // May accept 'none' algorithm

// SAFE - specify algorithm
jwt.verify(token, secret, { algorithms: ['HS256'] });
```

## Path Traversal
```javascript
// VULNERABLE
const file = path.join(uploadDir, userFilename);
fs.readFile(file);

// SAFE - validate resolved path
const file = path.join(uploadDir, path.basename(userFilename));
const resolved = path.resolve(uploadDir, userFilename);
if (!resolved.startsWith(path.resolve(uploadDir))) {
  throw new Error('Path traversal detected');
}
```
