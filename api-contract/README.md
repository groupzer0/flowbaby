# Flowbaby Cloud API Contract

> **This directory is the single source of truth for the Flowbaby Cloud API.**

## Purpose

The Flowbaby VS Code extension (this repo, public) and the Flowbaby Cloud backend (separate CDK repo, private) need to communicate reliably despite living in separate repositories with separate development workflows.

This contract ensures:
- **Shared understanding**: Extension and backend agents/developers reference the same types
- **Early integration**: Mismatches are caught at design time, not runtime
- **Safe evolution**: Versioning enables coordinated changes across repos

## Structure

| File | Description |
|------|-------------|
| `version.ts` | Contract version, last updated date, and changelog |
| `types.ts` | TypeScript interfaces for all request/response/error shapes |
| `endpoints.md` | Human-readable API documentation with URLs, methods, headers, and examples |

## Design Principles

### 1. TypeScript-First
Types are defined in `.ts` files that both extension and Lambda code can directly use or reference. No translation layer required.

### 2. Consistent Patterns
All endpoints follow these conventions:
- **Auth**: `Authorization: Bearer <flowbaby-session-token>` header
- **Errors**: Standard error envelope with `code`, `message`, and optional `retryAfter`
- **Responses**: Consistent casing and structure

### 3. Versioned from Day One
The `version.ts` file tracks the contract version. Breaking changes require:
1. Version bump (semver)
2. Migration notes in the changelog
3. Coordinated release across extension and backend

### 4. Future-Ready
This structure supports later migration to OpenAPI if needed:
- Add Zod schemas that mirror the TS types
- Use `zod-to-openapi` to generate OpenAPI spec
- Existing code continues to work unchanged

---

## Cross-Repo Synchronization

### Automatic Sync Workflow

Changes pushed to `api-contract/` on `main` trigger the [sync-contract workflow](../.github/workflows/sync-contract.yml), which:

1. Detects changes in `api-contract/**`
2. Opens a PR in `groupzer0/flowbaby-cloud` with the updated files
3. Updates the `source` field in `version.ts` to indicate the sync origin

```
┌─────────────────────────┐         ┌─────────────────────────┐
│  groupzer0/flowbaby     │         │  groupzer0/flowbaby-    │
│  (Extension Repo)       │         │  cloud (Backend Repo)   │
│                         │         │                         │
│  api-contract/          │  sync   │  api-contract/          │
│  ├── types.ts      ─────┼────────>│  ├── types.ts           │
│  ├── endpoints.md       │   PR    │  ├── endpoints.md       │
│  └── version.ts         │         │  └── version.ts         │
│                         │         │                         │
│  CANONICAL SOURCE       │         │  SYNCED COPY            │
└─────────────────────────┘         └─────────────────────────┘
```

#### Required Setup

The workflow requires a `CROSS_REPO_PAT` secret in the extension repo:

1. Create a **fine-grained** GitHub Personal Access Token at https://github.com/settings/personal-access-tokens/new
   - Recommended token name: `flowbaby-contract-sync`
2. Configure the token:
   - **Repository access**: Only select repositories → `groupzer0/flowbaby-cloud`
   - **Permissions** (Repository permissions):
     - Contents: **Read and write** (to push branches)
     - Pull requests: **Read and write** (to create PRs)
     - Metadata: Read-only (auto-selected)
3. Add it as a repository secret named `CROSS_REPO_PAT`:
   ```bash
   gh secret set CROSS_REPO_PAT --repo groupzer0/flowbaby
   ```

#### Manual Sync

To force a sync without changes:
1. Go to Actions → "Sync API Contract"
2. Click "Run workflow"
3. Check "Force sync even if no changes detected"

### For Extension Development (This Repo)
- Import types directly from `api-contract/types.ts`
- Check `version.ts` when debugging integration issues

### For CDK/Backend Development (Private Repo)

> **CDK agents should always fetch the latest contract before API work.**

The CDK repo should include an agent skill with these instructions:

```markdown
## Cross-Repo Contract Reference

Before implementing or modifying any API endpoint:
1. Reference the contract at: https://github.com/groupzer0/flowbaby/tree/main/api-contract
2. Ensure Lambda request/response shapes match `types.ts` exactly
3. If a breaking change is required, document it as an OPEN QUESTION

The contract version must match between extension and backend releases.
```

### Validation Approach

The CDK repo should include a test that:
1. Fetches (or copies) `types.ts` from this repo
2. Validates that Lambda handlers' I/O types are compatible
3. Fails CI on type mismatches

---

## Change Process

### Non-Breaking Changes (additive)
1. Add new optional fields or new endpoints to `types.ts`
2. Update `endpoints.md` with documentation
3. Bump patch version in `version.ts`

### Breaking Changes
1. Document the change as an OPEN QUESTION first
2. Get human approval across both repos
3. Update `types.ts` with the new shapes
4. Add migration notes to `version.ts` changelog
5. Bump major version
6. Coordinate release: backend deployed first, then extension

---

## Current Status

**Contract Version**: See `version.ts`

This contract was established as part of Plan 066 (Flowbaby Cloud Credential Vending) to ensure coherent development across the public extension and private CDK repositories.
