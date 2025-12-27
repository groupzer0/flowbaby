# Flowbaby Cloud API Endpoints

> Human-readable API documentation. See `types.ts` for TypeScript definitions.

## Base URL

- **Production**: `https://api.flowbaby.dev`
- **Staging**: `https://api-staging.flowbaby.dev`

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

## Versioning

This documentation corresponds to API Contract version specified in `version.ts`.

Breaking changes will be documented in the version changelog and require coordinated backend/extension releases.
