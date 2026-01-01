# Flowbaby Cloud API Endpoints

> Human-readable API documentation. See `types.ts` for TypeScript definitions.

## Base URL

| Environment | URL | Status |
|-------------|-----|--------|
| **Dev/Staging (preferred)** | `https://api-staging.flowbaby.ai` | **Planned** – use once custom domain is provisioned |
| **Dev/Staging (fallback)** | `https://0h552crqta.execute-api.us-east-1.amazonaws.com` | Live – current execute-api URL |
| **Production** | `https://api.flowbaby.ai` | **Planned** – use once custom domain is provisioned |

> **Extension default (v0.7.0)**: The extension defaults to `https://api-staging.flowbaby.ai` for staging/dev workflows.
> Once `api.flowbaby.ai` is provisioned, marketplace-facing builds will default to production.

> **Override options** (precedence: setting > env > default):
> 1. VS Code setting: `flowbaby.cloud.apiEndpoint`
> 2. Environment variable: `FLOWBABY_CLOUD_API_URL`
> 3. Built-in default (staging or production depending on build target)

---

## GitHub OAuth App Configuration (Backend Requirement)

The backend must have a configured GitHub OAuth App for the OAuth flow to work.

### Required OAuth App Settings

| Setting | Staging Value | Production Value |
|---------|---------------|------------------|
| **Application name** | `Flowbaby Cloud (Staging)` | `Flowbaby Cloud` |
| **Homepage URL** | `https://flowbaby.ai` | `https://flowbaby.ai` |
| **Authorization callback URL** | `https://api-staging.flowbaby.ai/auth/callback` (preferred) or `https://0h552crqta.execute-api.us-east-1.amazonaws.com/auth/callback` (fallback) | `https://api.flowbaby.ai/auth/callback` |

> **Note**: When transitioning from execute-api URL to custom domain, update the GitHub OAuth App callback URL accordingly.

### Required Secrets (AWS Secrets Manager)

| Secret Name | Description |
|-------------|-------------|
| `GITHUB_CLIENT_ID` | OAuth App client ID from GitHub |
| `GITHUB_CLIENT_SECRET` | OAuth App client secret from GitHub |

### Extension Expectation

The extension expects `/auth/login` to redirect to GitHub with a **valid** `client_id`. If the backend uses a placeholder value, GitHub will return 404 and the OAuth flow will fail.

**Verification Command**:
```bash
curl -I "https://0h552crqta.execute-api.us-east-1.amazonaws.com/auth/login?redirect_uri=vscode://Flowbaby.flowbaby/auth/callback"
# Expected: 302 redirect to github.com/login/oauth/authorize?client_id=<REAL_CLIENT_ID>&...
# Failure: client_id=PLACEHOLDER_CLIENT_ID → GitHub 404
```

---

## Authentication

All authenticated endpoints require:
```
Authorization: Bearer <flowbaby-session-token>
```

The session token is obtained from the `/auth/github` endpoint after GitHub OAuth.

---

## Endpoints

### GET /auth/login

Initiate the GitHub OAuth flow. This endpoint redirects the user's browser to GitHub's authorization page.

**Query Parameters**:

| Parameter | Required | Description |
|-----------|----------|-------------|
| `redirect_uri` | Yes | VS Code URI handler callback. Must be `vscode://Flowbaby.flowbaby/auth/callback` |
| `state` | No | CSRF token for security validation. If provided, echoed back in the callback. |

**Response**: HTTP 302 redirect to GitHub OAuth authorize URL

The backend constructs the GitHub authorize URL:
```
https://github.com/login/oauth/authorize?
  client_id=<GITHUB_CLIENT_ID>&
  redirect_uri=<backend-callback-url>&
  scope=read:user&
  state=<encoded-state-with-redirect_uri>
```

**Success Flow**:
1. User authorizes on GitHub
2. GitHub redirects to backend's callback handler (HTTPS URL, not vscode://)
3. Backend exchanges GitHub auth code for GitHub access token (server-side)
4. Backend creates/updates user record
5. Backend generates a **short-lived, single-use Flowbaby exchange code** (NOT the session token)
   - TTL: ≤60 seconds
   - Single-use: invalidated after first exchange attempt
   - Format: opaque string (e.g., UUID or signed token)
6. Backend redirects to extension: `<redirect_uri>?code=<flowbaby-exchange-code>` (and `state` if provided)
7. Extension calls `POST /auth/github` with the exchange code to obtain session token

**Deep-Link Format (Extension Expectation)**:
```
vscode://Flowbaby.flowbaby/auth/callback?code=<flowbaby-exchange-code>&state=<original-state>
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `code` | Yes | Flowbaby one-time exchange code (NOT GitHub's code) |
| `state` | If provided | Original CSRF state from GET /auth/login query |
| `error` | On failure | Error code (e.g., `access_denied`, `server_error`) |
| `error_description` | On failure | Human-readable error message |

**Error Flow**:
Backend redirects to extension with error: `<redirect_uri>?error=<error_code>&error_description=<message>`

| Error Code | Description |
|------------|-------------|
| `access_denied` | User declined GitHub authorization |
| `server_error` | Backend failed to process OAuth callback |

**Extension Implementation Reference**: See `extension/src/flowbaby-cloud/auth.ts` lines 171-178

---

### POST /auth/github

Exchange a Flowbaby one-time exchange code for a session token and refresh token.

> **IMPORTANT**: The `code` in this request is NOT the GitHub OAuth authorization code.
> It is the **Flowbaby one-time exchange code** issued by the backend after completing
> GitHub OAuth server-side. The backend deep-links this code to VS Code via
> `vscode://Flowbaby.flowbaby/auth/callback?code=<flowbaby-exchange-code>`.

**Request**: See `AuthRequest` in `types.ts`

**Response**: See `AuthResponse` in `types.ts`

**Errors**:
| Code | Description |
|------|-------------|
| `INVALID_CODE` | Flowbaby exchange code is invalid, expired, or already used |
| `STATE_MISMATCH` | CSRF state validation failed (state in request doesn't match stored state) |
| `GITHUB_ERROR` | GitHub API returned an error during user lookup |

---

### POST /auth/refresh

Exchange a valid refresh token for a new session token and new refresh token.

Refresh tokens are single-use and rotated on each successful refresh. The old refresh
token is invalidated immediately upon use.

**Request**: See `RefreshRequest` in `types.ts`

**Response**: See `AuthResponse` in `types.ts` (includes new `refreshToken`)

**Errors**:
| Code | Description |
|------|-------------|
| `INVALID_REFRESH` | Refresh token is invalid, expired, or already used |

**Usage Pattern**:
- Extension stores `refreshToken` in VS Code `SecretStorage`
- Before session expires (e.g., when <10% TTL remains), call this endpoint
- On success, store new `sessionToken` and `refreshToken`
- On failure (`INVALID_REFRESH`), prompt user to re-authenticate via OAuth

---

### POST /vend/credentials

Request temporary AWS STS credentials for Bedrock access.

**Request**: See `VendRequest` in `types.ts`

**Response**: See `VendResponse` in `types.ts`

**Errors**:
| Code | Description |
|------|-------------|
| `SESSION_EXPIRED` | Session token has expired; re-authenticate |
| `QUOTA_EXCEEDED` | Credit limit reached for current window |
| `TIER_INVALID` | User tier does not permit this operation |

---

## Staging-Only Endpoints

These endpoints exist only in dev/staging environments for integration testing.
They **MUST NOT** be deployed to production.

### Test Infrastructure Responsibilities

| Actor | Responsibility |
|-------|----------------|
| **Backend CI** | Retrieves `X-Staging-Test-Key` from Secrets Manager |
| **Backend CI** | Provisions session tokens for cross-repo testing |
| **Extension CI** | Receives session tokens (never the key itself) |
| **Extension code** | NEVER accesses test-token endpoint or staging secrets |

> **Security**: The `X-Staging-Test-Key` must remain within backend infrastructure.
> Extension E2E tests should receive short-lived session tokens, not the staging key.

### POST /auth/test-token

Bypass OAuth to obtain a test session token. Used for CI/CD and integration testing.

**Headers**:
```
X-Staging-Test-Key: <staging-test-key-from-secrets-manager>
```

**Request**:
```json
{
  "testAccount": "test-free" | "test-basic"
}
```

**Response**: Same as `AuthResponse` in `types.ts`

**Test Accounts**:
| Account | githubId | Tier |
|---------|----------|------|
| `test-free` | `9990002345` | `free` |
| `test-basic` | `9990006789` | `basic` |

**Security**: Returns 404 if `FLOWBABY_ENV !== 'dev'`

---

## Error Envelope

All errors follow the `ApiError` shape:

```json
{
  "code": "QUOTA_EXCEEDED",
  "message": "Free tier monthly credit limit reached. Upgrade or wait until the 1st of next month.",
  "retryAfter": 86400
}
```

---

## OAuth Flow Diagram

```
┌──────────────┐     ┌─────────────┐     ┌────────────┐     ┌─────────────┐
│  VS Code     │     │   Backend   │     │   GitHub   │     │  VS Code    │
│  Extension   │     │   API       │     │   OAuth    │     │  URI Handler│
└──────┬───────┘     └──────┬──────┘     └─────┬──────┘     └──────┬──────┘
       │                    │                  │                   │
       │ GET /auth/login    │                  │                   │
       │ ?redirect_uri=     │                  │                   │
       │──────────────────>│                  │                   │
       │                    │                  │                   │
       │        302 Redirect to GitHub         │                   │
       │<─ ─ ─ ─ ─ ─ ─ ─ ─ ─│                  │                   │
       │                    │                  │                   │
       │        User authorizes on GitHub      │                   │
       │───────────────────────────────────────>│                   │
       │                    │                  │                   │
       │                    │   OAuth callback │                   │
       │                    │<─────────────────│                   │
       │                    │                  │                   │
       │                    │ Exchange code    │                   │
       │                    │─────────────────>│                   │
       │                    │                  │                   │
       │                    │ GitHub token     │                   │
       │                    │<─────────────────│                   │
       │                    │                  │                   │
       │     302 Redirect to vscode://...?code=xxx                 │
       │<─ ─ ─ ─ ─ ─ ─ ─ ─ ─│                  │                   │
       │                    │                  │                   │
       │                    │                  │    URI callback   │
       │                    │                  │   with code       │
       │<──────────────────────────────────────────────────────────│
       │                    │                  │                   │
       │ POST /auth/github  │                  │                   │
       │ {code: "xxx"}      │                  │                   │
       │──────────────────>│                  │                   │
       │                    │                  │                   │
       │   AuthResponse     │                  │                   │
       │   {sessionToken}   │                  │                   │
       │<──────────────────│                  │                   │
       │                    │                  │                   │
```

---

## Versioning

This documentation corresponds to API Contract version specified in `version.ts`.

Breaking changes will be documented in the version changelog and require coordinated backend/extension releases.
