---
name: security-patterns
description: Security vulnerability detection patterns including OWASP Top 10, language-specific vulnerabilities, and remediation guidance. Load when reviewing code for security issues, conducting audits, or implementing authentication/authorization.
license: MIT
metadata:
  author: groupzer0
  version: "1.0"
---

# Security Patterns

Systematic approach to identifying and remediating security vulnerabilities. Use this skill when:
- Reviewing code for security vulnerabilities
- Conducting security audits
- Implementing authentication, authorization, or data handling
- Assessing third-party dependencies

## OWASP Top 10 (2021) Quick Detection

### A01: Broken Access Control
**Detection patterns:**
- Missing authorization checks on endpoints
- Direct object references without ownership validation
- Path traversal: `../` in file paths
- CORS with `Access-Control-Allow-Origin: *`
- JWT without signature verification

**Remediation:**
- Implement RBAC/ABAC at controller/service layer
- Validate ownership on every resource access
- Use allowlists for file paths
- Configure CORS with specific origins

### A02: Cryptographic Failures
**Detection patterns:**
- MD5/SHA1 for passwords
- Hardcoded encryption keys
- HTTP for sensitive data
- Weak random: `Math.random()`, `rand()`
- Missing encryption at rest

**Remediation:**
- Use bcrypt/argon2 for passwords (cost ≥12)
- External key management (KMS, Vault)
- TLS 1.2+ everywhere
- Cryptographic RNG only

### A03: Injection
**Detection patterns:**
- String concatenation in SQL/NoSQL queries
- Template literals in HTML without escaping
- `eval()`, `exec()`, `Function()` with user input
- Shell commands with string interpolation
- LDAP/XPath queries with user input

**Remediation:**
- Parameterized queries always
- Context-aware output encoding
- Never eval untrusted input
- Use ORM/query builders

### A04: Insecure Design
**Detection patterns:**
- Business logic without rate limiting
- Missing account lockout
- No CAPTCHA on authentication
- Unbounded resource allocation
- Missing threat model documentation

**Remediation:**
- Rate limit all sensitive operations
- Implement progressive delays
- Bound all allocations
- Document trust boundaries

### A05: Security Misconfiguration
**Detection patterns:**
- Default credentials in config
- Verbose error messages to users
- Debug mode in production
- Unnecessary services enabled
- Missing security headers

**Remediation:**
- Automated hardening scripts
- Generic error messages externally
- Disable debug in production
- Minimize attack surface

### A06: Vulnerable Components
**Detection patterns:**
- Dependencies with known CVEs
- Outdated framework versions
- Abandoned packages (no updates >2 years)
- Single-maintainer critical deps

**Remediation:**
- Automated dependency scanning
- Regular update schedule
- Evaluate package health before adoption
- Pin specific versions with lockfiles

### A07: Authentication Failures
**Detection patterns:**
- Weak password requirements
- Missing brute force protection
- Session tokens in URL
- No session timeout
- Plain passwords in logs

**Remediation:**
- Strong password policy
- Account lockout/delays
- Secure cookie flags
- Session timeout <30 min idle
- Never log credentials

### A08: Data Integrity Failures
**Detection patterns:**
- Deserialization of untrusted data
- Missing integrity checks on downloads
- Unsigned software updates
- CI/CD without verification

**Remediation:**
- Avoid native deserialization
- Verify checksums/signatures
- Sign all releases
- Secure CI/CD pipeline

### A09: Logging Failures
**Detection patterns:**
- No logging on auth events
- Sensitive data in logs
- Logs without timestamps
- No centralized logging
- Missing alerting

**Remediation:**
- Log all security events
- Sanitize log data
- Structured logging with timestamps
- Centralize with retention policy

### A10: SSRF
**Detection patterns:**
- User-controlled URLs in server requests
- Internal service access without validation
- Cloud metadata endpoint accessible
- URL parsing inconsistencies

**Remediation:**
- Allowlist URLs/domains
- Block internal IP ranges
- Disable cloud metadata endpoint
- Use URL parser consistently

---

## Language-Specific Patterns

See detailed references:
- [references/javascript-vulnerabilities.md](references/javascript-vulnerabilities.md)
- [references/python-vulnerabilities.md](references/python-vulnerabilities.md)
- [references/java-vulnerabilities.md](references/java-vulnerabilities.md)
- [references/go-vulnerabilities.md](references/go-vulnerabilities.md)

---

## Security Headers Checklist

| Header | Value | Purpose |
|--------|-------|---------|
| `Content-Security-Policy` | `default-src 'self'` | Prevent XSS |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing |
| `X-Frame-Options` | `DENY` | Prevent clickjacking |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Force HTTPS |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limit referrer leakage |
| `Permissions-Policy` | `geolocation=(), camera=()` | Disable unused APIs |

---

## STRIDE Threat Modeling

| Threat | Question | Controls |
|--------|----------|----------|
| **Spoofing** | Can attacker impersonate? | Auth, MFA, certificates |
| **Tampering** | Can data be modified? | Integrity checks, MACs |
| **Repudiation** | Can actions be denied? | Audit logs, signing |
| **Information Disclosure** | Can data leak? | Encryption, access control |
| **Denial of Service** | Can service be disrupted? | Rate limits, redundancy |
| **Elevation of Privilege** | Can user gain access? | RBAC, input validation |
