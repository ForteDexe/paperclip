---
navigation: {"section":"Apps, channels, and extensions","sectionOrder":50,"order":50}
---

# Secrets and proposals

This map records the retained compatibility and redaction contracts. Outpost no
longer exposes a Settings > Secrets management surface, and new local
Codex/Claude agents use credentials from their already-authenticated CLI.

Feature ID: `secrets`.

Implementation: [compatibility API](../../ui/src/api/secrets.ts), [runtime service](../../server/src/services/secrets.ts), [proposal helpers](../../ui/src/pages/secrets/proposal-review.tsx).

Agent access: [companion](../agent-access-map/secrets.md).

## Sub-features

- `space-secrets`: `secrets/space-secrets` — create/update secret references and control their bindings.
- `user-secrets`: `secrets/user-secrets` — define required user credentials and set a value for the current user.
- `proposals`: `secrets/proposals` — review proposed changes with the appropriate authority.
- `vault-import`: `secrets/vault-import` — import eligible external-vault references through the offered flow.
- `runtime-delivery`: `secrets/runtime-delivery` — deliver only the secret references authorized for the run/actor. Agent-owned instance secrets stay in the trusted server runtime and are never delivered to an agent.

## How to get to it (user POV)

### `secret-management`

There is no general secret-management page. A legacy task or run can still show
an inline compatibility prompt when an existing record requires a user value.

### `proposal-import`

No proposal or vault-import management page is exposed.

## Driving it with Playwright and the Outpost CLI

Preconditions: follow the [baseline](./README.md#before-driving-a-journey). Use dummy credentials in an isolated space, two user identities, and a test agent. Never print actual secret values in evidence.

**Operation checkpoints**

Use these checks alongside the entry-point recipes below and the operation records in the [access companion](../agent-access-map/secrets.md). Record the actual actor, surface, saved result and denial separately. Source review and linked tests do not establish a live pass.

| Capability ID | Action and persisted result | Denial, race and retry checks |
| --- | --- | --- |
| `secrets/space-secrets` | Create a dummy space reference; inspect metadata, usage and access history; update, rotate, bind, and remove separate disposable references. | Reload each change and test read versus manage authority, foreign IDs, stale bindings and in-use deletion. Metadata, errors and audit must omit values. Rotation and metadata edits have different effects. |
| `secrets/user-secrets` | Manage a credential definition and inspect coverage as an authorized operator; create, update, rotate and remove the current person’s dummy value. | Use two signed-in people. Definition/coverage authority does not grant another person’s value. Check missing values, wrong definitions, cross-space references and owner-scoped persistence. |
| `secrets/proposals` | Use an actual permitted run to propose a new secret or binding; inspect its redacted preview, withdraw one, reject one, and approve a fresh one. | Check target/value authority before applying. Test expiry, duplicate/conflicting decisions, revoked context and malformed run attribution. Inspect created reference/binding and audit once, without displaying the dummy value. |
| `secrets/vault-import` | Manage a disposable provider configuration, default and health check; preview eligible AWS references and import only selected test entries. | Check provider/admin authority, unsupported vaults, failed discovery/health, duplicate imports and foreign IDs. Imported references still need permitted value resolution; provider registration does not prove a working vault. |
| `secrets/runtime-delivery` | Bind a dummy reference to a permitted environment/config path and use the actual run to check delivery without printing the value. Inspect the agent’s permitted metadata catalog separately. | Deny ordinary agent-key value reads, user/instance-scope reads through the agent value API, and missing/wrong run or binding. Check Stop/revocation, redacted logs/errors and isolation of another person’s value. |

### `secret-management`

Automated: [secrets service](../../server/src/__tests__/secrets-service.test.ts) and [user ownership](../../server/src/__tests__/secrets-service-user-secret-owner-scoped.test.ts) cover storage/access contracts. [Instance-secret tests](../../server/src/__tests__/agent-instance-secrets.test.ts) cover local encrypted storage, owner isolation, and exclusion from ordinary bindings.

Manual: Create a dummy secret reference, bind it through a supported field, and verify its use in a harmless run without logging the value. Update it and reload. Switch users and confirm personal values remain owner-scoped and missing credentials produce an actionable state.

### `proposal-import`

Automated: [proposal routes](../../server/src/__tests__/secret-proposals-routes.test.ts) and [secret routes](../../server/src/__tests__/secrets-routes.test.ts) cover retained backend compatibility; a real vault integration needs live validation.

Manual: Review a dummy proposal, reject one and accept another, then inspect the resulting reference state and history. Preview a vault import, select only disposable entries, and verify imported references and denied-access errors after reload.

## Gotchas

- Vault import currently targets eligible AWS Secrets Manager providers.
  Organization-secret checks in local-trusted mode do not establish two-user
  personal-secret ownership or actual external-vault import.

- A displayed reference name is not proof that the actor can resolve its value at runtime.
- Space secrets and user-specific values have different ownership.
- Redaction needs verification in errors, activity, and run logs as well as the form.

### Storybook verification

#### `proposals`

Capability ID: `secrets/proposals`.

Scope: ui
Storybook: Mount ProposalsTab pending secret/binding proposals, blocked authority, expired/resolved proposal, approval/rejection pending/error, and redacted metadata.
Production: GET /spaces/{id}/secret-proposals and POST approve/reject must enforce space/admin/target authority, durable resolution and redaction; verified run-bound agent proposal creation is separate.
Sources: Source: [proposal-review.tsx](../../ui/src/pages/secrets/proposal-review.tsx), [secrets.ts](../../server/src/routes/secrets.ts), [secret-proposal-authorization.ts](../../server/src/services/secret-proposal-authorization.ts). Tests: [secret-proposals-routes.test.ts](../../server/src/__tests__/secret-proposals-routes.test.ts)

### Documentation scope: Secrets and secret proposals

Space/user/proposal/vault and runtime-binding paths are mapped; every secret provider, rotation scenario, and delivery context needs separate validation.
