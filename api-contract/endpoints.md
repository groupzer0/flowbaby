# Flowbaby Cloud API Endpoints

> Human-readable API documentation. See `types.ts` for TypeScript definitions.

## Base URL

- **Dev/Staging**: `https://0h552crqta.execute-api.us-east-1.amazonaws.com`
- **Production**: `https://api.flowbaby.ai`

> **Extension configuration**: Use `FLOWBABY_CLOUD_API_URL` environment variable to override (defaults to production).

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
2. GitHub redirects to backend's callback handler
3. Backend exchanges code for GitHub token
4. Backend creates/updates user record and generates session JWT
5. Backend redirects to extension: `<redirect_uri>?code=<flowbaby-auth-code>`

**Error Flow**:
Backend redirects to extension with error: `<redirect_uri>?error=<error_code>&error_description=<message>`

| Error Code | Description |
|------------|-------------|
| `access_denied` | User declined GitHub authorization |
| `server_error` | Backend failed to process OAuth callback |

**Extension Implementation Reference**: See `extension/src/flowbaby-cloud/auth.ts` lines 171-178

---

### POST /auth/github

Exchange a GitHub OAuth code for a Flowbaby session token.

**Request**: See `AuthRequest` in `types.ts`

**Response**: See `AuthResponse` in `types.ts`

**Errors**:
| Code | Description |
|------|-------------|
| `INVALID_CODE` | OAuth code is invalid or expired |
| `GITHUB_ERROR` | GitHub API returned an error |

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
