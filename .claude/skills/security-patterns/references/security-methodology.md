# Security Review Methodology

Detailed phase-by-phase methodology for comprehensive security reviews.

---

## Phase 1: Architectural Security Review

**Objective**: Identify systemic weaknesses in system design before code is written.

### 1. Trust Boundary Analysis
- Map all trust boundaries in the system
- Identify where data crosses boundaries (user→app, app→database, service→service)
- Verify authentication/authorization at every boundary crossing
- Document implicit trust assumptions that may be violated

### 2. Data Flow Diagram (DFD) Security Analysis
- Create or review data flow diagrams
- Trace sensitive data from entry to storage to exit
- Identify all points where data could be exposed, modified, or intercepted
- Verify encryption in transit and at rest

### 3. Attack Surface Mapping
- Enumerate all entry points: APIs, UIs, file uploads, integrations
- Identify exposed services, ports, protocols
- Map external dependencies and their access levels
- Assess each entry point's exposure risk

### 4. STRIDE Threat Modeling

| Threat | Questions to Ask |
|--------|------------------|
| **S**poofing | Can an attacker impersonate users, services, or systems? |
| **T**ampering | Can data be modified in transit or at rest without detection? |
| **R**epudiation | Can actions be denied? Are audit logs tamper-proof? |
| **I**nformation Disclosure | Where could sensitive data leak? Logs, errors, side channels? |
| **D**enial of Service | What resources can be exhausted? Rate limits in place? |
| **E**levation of Privilege | Can users gain unauthorized access? RBAC enforced? |

### 5. Architecture Anti-Pattern Detection
- **Flat networks**: No segmentation between sensitive and non-sensitive systems
- **Shared credentials**: Same secrets across environments or services
- **Implicit trust**: Services trusting each other without verification
- **Single points of failure**: One compromised component = full breach
- **Overprivileged services**: Services with more access than needed
- **Missing observability**: No way to detect attacks in progress

**Output**: `agent-output/security/NNN-[topic]-architecture-security.md`

---

## Phase 2: Code Security Review

**Objective**: Identify implementation vulnerabilities, insecure patterns, and logic flaws.

### 1. OWASP Top 10 Check
Reference the OWASP Top 10 quick detection table in the main `SKILL.md`.

### 2. Language-Specific Patterns
Load language-specific vulnerability references:
- `javascript-vulnerabilities.md`
- `python-vulnerabilities.md`
- `java-vulnerabilities.md`
- `go-vulnerabilities.md`

### 3. Authentication & Session Security
- Password storage: bcrypt/argon2 with proper cost factors?
- Session tokens: sufficient entropy, secure cookie flags?
- Token expiration and rotation policies
- Multi-factor authentication implementation
- OAuth/OIDC implementation correctness
- JWT validation (algorithm confusion, secret strength, expiration)

### 4. Authorization & Access Control
- RBAC/ABAC implementation correctness
- Horizontal privilege escalation (accessing other users' data)
- Vertical privilege escalation (becoming admin)
- API endpoint authorization consistency
- File/resource access control
- Admin interface protection

### 5. Input Validation & Output Encoding
- Server-side validation (never trust client-only)
- Allowlist vs blocklist approaches
- Context-appropriate output encoding
- Content-Type headers and charset
- File upload validation (type, size, content)

### 6. Error Handling & Information Disclosure
- Stack traces exposed to users
- Verbose error messages revealing system info
- Debug endpoints left enabled
- Source maps in production
- Comments containing sensitive information

### 7. Secrets & Configuration
- Hardcoded credentials, API keys, tokens
- Secrets in version control history
- Environment variable exposure
- Configuration file permissions
- Secrets rotation capability

**Output**: `agent-output/security/NNN-[topic]-code-audit.md`

---

## Phase 3: Dependency & Supply Chain Security

**Objective**: Identify risks from third-party code and supply chain attacks.

### 1. Dependency Vulnerability Scanning
- Run `npm audit`, `pip-audit`, `cargo audit`, `bundler-audit`
- Cross-reference with NVD/CVE databases
- Check GHSA (GitHub Security Advisories)
- Assess actual exploitability in context

### 2. Dependency Risk Assessment
- Abandoned packages (no recent updates, unresponsive maintainers)
- Single maintainer packages (bus factor = 1)
- Typosquatting risks in package names
- Excessive dependencies (deep dependency trees)
- License compliance risks

### 3. Supply Chain Attack Vectors
- Compromised package registries
- Malicious package updates
- Dependency confusion attacks
- Build system compromise
- CI/CD pipeline security

### 4. Lockfile & Version Pinning
- Lockfiles present and committed
- Exact version pinning vs ranges
- Integrity hashes verified
- Reproducible builds possible

**Output**: `agent-output/security/NNN-[topic]-dependency-audit.md`

---

## Phase 4: Infrastructure & Configuration Security

**Objective**: Ensure secure deployment and runtime configuration.

### 1. Security Headers Assessment
- `Content-Security-Policy` (CSP)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options` / `frame-ancestors`
- `Strict-Transport-Security` (HSTS)
- `X-XSS-Protection` (legacy browsers)
- `Referrer-Policy`
- `Permissions-Policy`

### 2. TLS/SSL Configuration
- Protocol versions (TLS 1.2+ only)
- Cipher suite strength
- Certificate validity and chain
- HSTS preload status

### 3. Container & Cloud Security
- Non-root container execution
- Read-only filesystems where possible
- Resource limits and quotas
- Network policies and segmentation
- IAM roles and policies (least privilege)
- Secrets management (not in env vars or images)

### 4. Logging & Monitoring
- Security event logging
- Log integrity protection
- Alerting on anomalies
- Incident response capability

---

## Phase 5: Compliance & Standards Mapping

**Objective**: Ensure adherence to relevant security standards and regulations.

### Standards Reference
- **OWASP ASVS**: Application Security Verification Standard levels 1-3
- **NIST Cybersecurity Framework**: Identify, Protect, Detect, Respond, Recover
- **CIS Controls**: Prioritized security actions
- **SOC 2**: Trust service criteria (if applicable)
- **GDPR/CCPA**: Data protection requirements (if applicable)
- **PCI-DSS**: Payment card security (if applicable)
- **HIPAA**: Healthcare data (if applicable)

> **Tip**: When deeper detail is needed, use the `fetch` tool to retrieve authoritative sources (e.g., OWASP ASVS checklist, NIST 800-53 controls).

---

## Severity Classification (CVSS-Aligned)

| Severity | CVSS Score | Response Time | Definition |
|----------|------------|---------------|------------|
| **Critical** | 9.0 - 10.0 | Immediate | Active exploitation possible, data breach imminent |
| **High** | 7.0 - 8.9 | 24-48 hours | Significant vulnerability, exploitation likely |
| **Medium** | 4.0 - 6.9 | 1-2 weeks | Moderate risk, requires specific conditions |
| **Low** | 0.1 - 3.9 | Next sprint | Minor issue, minimal impact |
| **Informational** | N/A | Backlog | Best practice, no direct vulnerability |
