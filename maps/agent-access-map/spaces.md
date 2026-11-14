# Spaces and portability — agent access

Product map: [Spaces and portability](../feature-map/spaces.md).

Feature ID: `spaces`.

Review date: 2026-10-12. Source commit: `58e16dbddfc9c8d0cf60867f9d9847f0feda055b`.
Native REST transport reconciled in this change; see the
[shared transport contract](README.md#native-rest-transport).

This is a source-reviewed baseline of representative operations and known gaps.
Each capability needs operation-level review before its entire scope can be
qualified. No live agent execution is claimed. Follow the [map contract](../README.md)
for format, permission checks, evidence and maintenance.

## `selection`

Capability ID: `spaces/selection`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `GET /api/spaces/{spaceId}`.
- `GET /api/spaces`.
- `POST /api/spaces`.

Agent access: `partial` — Agent reads its bound space; CLI context chooses it; board
lists/creates spaces.

Policy: Same-space CEO or board for identity/import operations; list/create/archive
convenience endpoint is board-gated.

Evidence: `source-only` — [implementation](../../server/src/routes/spaces.ts#L1245)
at the reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, space or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: A worker cannot enumerate/create spaces via its space agent key. Browser
selection is local state.

## `identity`

Capability ID: `spaces/identity`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `PATCH /api/spaces/{spaceId}`.
- `PATCH /api/spaces/{spaceId}/branding`.

Agent access: `available` — Same-space CEO REST / native call_api / CLI space.

Policy: Same-space CEO or board for identity/import operations; list/create/archive
convenience endpoint is board-gated.

Evidence: `source-only` — [implementation](../../server/src/routes/spaces.ts#L1245)
at the reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, space or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: The CEO restriction is a real policy, not a missing API; ordinary employees need
denial evidence.

## `archive`

Capability ID: `spaces/archive`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `POST /api/spaces/{spaceId}/archive`.
- `PATCH /api/spaces/{spaceId}`.

Agent access: `partial` — Board archive endpoint; CEO space PATCH can express status
changes.

Policy: Same-space CEO or board for identity/import operations; list/create/archive
convenience endpoint is board-gated.

Evidence: `source-only` — [implementation](../../server/src/routes/spaces.ts#L1245)
at the reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, space or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: Convenience archive and general space PATCH have different authorization. Review
equivalence rather than declaring all archival human-only.

## `portability`

Capability ID: `spaces/portability`.

Review: `baseline`.

API: `present` — representative operation IDs:

- `POST /api/spaces/{spaceId}/exports`.
- `POST /api/spaces/{spaceId}/imports/preview`.
- `POST /api/spaces/{spaceId}/imports/apply`.

Agent access: `partial` — Same-space CEO REST / native `call_api` / CLI exports
and eligible same-space imports.

Policy: Same-space CEO or board for identity/import operations; list/create/archive
convenience endpoint is board-gated.

Evidence: `source-only` — [implementation](../../server/src/routes/spaces.ts#L1245)
at the reviewed commit above.

Verification: `not-run` — exercise a listed permitted operation with actual agent
credentials/run context; inspect its result and applicable persistence/attribution.
Assert the relevant denied actor, owner, space or mode from Policy. Review the
remaining operations before qualifying the whole capability.

Gaps: Exports use inline credential delivery and encrypted mutation receipts.
New-space/ZIP import flows retain their board and transport constraints.

## `decision-models`

Capability ID: `spaces/decision-models`.

Review: `baseline`.

API: `present` — GET and PUT /api/spaces/{spaceId}/decision-model;
POST /api/spaces/{spaceId}/decision-model/test;
GET /api/spaces/{spaceId}/decision-model/availability;
GET /api/spaces/{spaceId}/decision-model/history.

Agent access: `partial` — same-space REST and admitted native call_api
availability/history reads where policy allows. Settings and the fixed Test
action require board identity. Native rollout/run gates follow the shared
[transport contract](README.md#native-rest-transport).

Policy: Settings access requires board and space access; non-managers receive
no settings or choices. Configuration and tests additionally require connection
management authority (owner/admin, instance admin, or tools:manage_connections).
History requires space_scope:read and redacts task/run links without issue:read.
Background sponsorship and budget admission remain separate service checks.

Evidence: `source-only` — reviewed on 2026-10-13 at
`60bc0d5fee9a6e48db08fc016521fee3d9f57d67`:
[routes](../../server/src/routes/decision-models.ts),
[service](../../server/src/services/decision-models.ts), and
[connection authority](../../server/src/routes/ai-connections.ts).

Verification: `not-run` — read history with an allowed space actor and an actor
without task access; check link redaction. Reject agent configuration/tests and
board mutations without connection-management permission. Verify settings and
bounded test receipts with an owned simulated provider.

Gaps: No agent settings/test path; permitted history does not delegate management.
Live native and agent-credential reads remain unverified.

## `fast-responses`

Capability ID: `spaces/fast-responses`.

Review: `baseline`.

API: `present` — GET and PUT /api/spaces/{spaceId}/fast-response;
GET /api/spaces/{spaceId}/fast-response/models;
GET /api/spaces/{spaceId}/fast-response/availability;
POST /api/spaces/{spaceId}/fast-response/test;
GET /api/spaces/{spaceId}/fast-response/history.

Agent access: `partial` — same-space REST and admitted native call_api history
reads where policy allows, subject to the shared
[transport contract](README.md#native-rest-transport).
Settings, model selection, availability and test controls require board identity.

Policy: Board and space access gate configuration surfaces. Updates, models
and tests additionally require connection-management authority. History requires
space_scope:read; task/run links require issue:read. The experiment, provider
account, sponsorship and budget controls still gate actual acknowledgements.

Evidence: `source-only` — reviewed on 2026-10-13 at
`60bc0d5fee9a6e48db08fc016521fee3d9f57d67`:
[routes](../../server/src/routes/fast-responses.ts),
[service](../../server/src/services/fast-responses.ts), and
[connection authority](../../server/src/routes/ai-connections.ts).

Verification: `not-run` — inspect history and redacted task links as an allowed
space actor. Reject agent settings/models/availability/tests and unauthorized
board mutations. Use a simulated provider to inspect a saved configuration,
success receipt, timeout and recorded usage.

Gaps: No agent configuration/test path. An acknowledgement is not completed task
work. Live native, provider and agent access remain unverified.

## `prompt-injection-prevention`

Capability ID: `spaces/prompt-injection-prevention`.

Review: `baseline`.

API: `present` — GET/PUT /api/spaces/{spaceId}/prompt-injection-prevention,
GET /api/spaces/{spaceId}/prompt-injection-prevention/models, and
POST /api/spaces/{spaceId}/prompt-injection-prevention/test.

Agent access: `restricted` — management is board-only. Admitted gateway tool
results use saved configuration through an internal service, not an agent API.

Policy: Space access, connection-management permission, shared OpenRouter API
keys, credential audience, installation, and budgets remain enforced. Identified
users cannot become sponsored callers after a denial. See
[routes](../../server/src/routes/prompt-injection-prevention.ts) and
[service](../../server/src/services/prompt-injection-prevention.ts).

Evidence: `source-only` — [service tests](../../server/src/__tests__/prompt-injection-prevention.test.ts)
and [gateway tests](../../server/src/__tests__/prompt-injection-gateway.test.ts)
exercise permissions, billing, fallback, and persisted evidence; execution results
belong in the change's PR.

Verification: `not-run` — Reject agent management and foreign-space requests. Assert model
verdicts at admitted result boundaries and the original regex on dependency failure.

Gaps: No agent-facing mechanism to request a board configuration change is added.
