# Agent complaints and suggestions

Agents submit incidental feedback into the current instance's `agent_commentary`
table. Complaints preserve a raw reaction; suggestions describe an improvement.
Both are free-form, internally attributed records, not anonymous feedback.

## Agent entry points

Skill-capable legacy adapters automatically receive `complain` and
`suggestion-box` alongside the `outpost` operational skill, including existing
agents with empty optional-skill selections. The shared helper lives in that
operational skill at `scripts/submit-agent-commentary.mjs`. It reads the body
from stdin and uses the existing `OUTPOST_API_URL`, `OUTPOST_API_KEY`,
`OUTPOST_SPACE_ID`, and `OUTPOST_RUN_ID`. The helper uses the existing
Node.js runtime with no additional dependencies; custom runtimes can call HTTP
directly. Sandboxed runs use the callback bridge.

Native runs receive `submit_complaint({body, idempotencyKey})` and
`submit_suggestion({body, idempotencyKey})` in standard, ask, and planning modes.
Specialized completion-review runs retain their restricted tool set. Native
submission uses the bound authority without a shell or API credential.
Submit before finishing the run.

Instructions closely adapt Warp's
[complain](https://github.com/warpdotdev/common-skills/blob/main/.agents/skills/complain/SKILL.md)
and [suggestion-box](https://github.com/warpdotdev/common-skills/blob/main/.agents/skills/suggestion-box/SKILL.md)
skills, with their MIT notices included. Outpost changes the transport,
attribution, suggestion form, and size limit. Agents submit proactively when
warranted, without routine previews or announcements, then continue working.
Answer truthfully if a user asks about feedback or submitted content. Operators
can exclude these legacy skills through the existing runtime skill policy.
Brevity and at most three suggestions per run are guidance, not server quotas.
Do not report the same incident through both paths or retry failed submissions.

## HTTP contract

`POST /api/spaces/:spaceId/agent-commentary` accepts an authenticated agent
and its active run (`Authorization: Bearer …`, `X-Outpost-Run-Id: …`):

```json
{"kind":"suggestion","body":"The tool returned before persistence completed. Wait for the write before returning success.","idempotencyKey":"write-completion-1"}
```

Only these three fields are accepted. Identity and the optional task reference
are server-derived. Board callers cannot impersonate agent feedback. Native runs
use their dedicated tools rather than this legacy HTTP path.

Bodies must contain non-whitespace text and may contain up to 524,288 JavaScript
string code units, matching ordinary issue documents. No truncation is applied.
Existing 10 MiB HTTP and callback bridge request limits remain. Keys are nonempty
and at most 240 characters.

Creation returns HTTP 201 with `{id, kind, createdAt, replayed:false}`. Identical
replay in the same space/run returns HTTP 200 with the same ID and timestamp
and `replayed:true`. Conflicting key reuse returns 409. Invalid input returns 400;
invalid authority returns 401/403; storage failure returns a sanitized 503.
Authorization precedes replay. The helper accepts an optional second argument
for a stable key, generating one otherwise. It makes one request with a
10-second HTTP deadline and exits zero on failure with a content-free diagnostic.
It never follows redirects with credentials or claims an uncertain write succeeded.

## Storage and inspection

Rows contain space, agent, run, nullable issue, kind, body, retry key, payload
hash, and timestamp. Known run secrets and credential syntax are redacted before
storage; instructions remain essential because redaction cannot guarantee
secrecy. Writes and one content-free activity record commit together. Feedback
bodies are excluded from HTTP diagnostics and dedicated mutation receipts.

Browse feedback at Audit → Commentary (`/activity/commentary`). The page has
text search, agent/type filters, 50-message pages and a full-message dialog with
task/run context. Filters, page offsets and selected messages have shareable
URLs (`?entry=<message-id>` opens a message directly).

The board-only read API is `GET /api/spaces/:spaceId/agent-commentary`
(`agentId`, `kind`, `q`, `limit` up to 100, `offset`) and
`GET /api/spaces/:spaceId/agent-commentary/:id`. Both require space access
and `commentary:view`. All human space roles, including viewers, receive this
permission by default. The upgrade migration grants it to existing active human
members without changing existing commentary grants. Human invitation approval
adds the default to saved grant lists that omit it, including older invitations,
while preserving an explicit commentary grant's scope. Commentary access does not
grant agent-action audit access, detailed audit filters or audit CSV exports;
those retain `audit:view_agent_actions`. Source-task privacy filters previews, counts and
details. List results contain at most 280 characters
per message; the full body is loaded only on opening a message. Feedback whose
source task was deleted stays hidden, using the task binding retained on its run.

There is no notification, automatic task creation, or external forwarding.
This is separate from first-party Telemetry, OpenTelemetry
Observability, and the run log. Ordinary provider transcripts can still contain
submitted tool arguments; there is no anonymity or ephemeral-storage promise.

Authorized operators inspect the instance database, for example:

```sql
SELECT id, kind, body, agent_id, run_id, issue_id, created_at
FROM agent_commentary
WHERE space_id = '<space UUID>'
ORDER BY created_at DESC;
```

The service enforces space/run ownership. Foreign keys clear the task reference
on task deletion and cascade deletion with its run, agent, or space. Normal
logical database backups include these rows. No retention scheduler or backfill.

## Verification

Focused coverage lives in `server/src/__tests__/agent-commentary.integration.test.ts`,
`agent-commentary-helper.test.ts`, `agent-commentary-skills.test.ts`, the shared validator tests, and the HTTP logger
and sandbox callback bridge suites. These exercise real PostgreSQL and routes,
atomic audit rollback, replay races, authority changes, deletion, default mounts,
Unicode, and the exact document-body boundary.

The opt-in live smoke uses existing Codex login credentials, copied to a private
temporary home, and a disposable instance database. It calls the real legacy
adapter and production native-session executor. It incurs normal provider usage:

```sh
node cli/node_modules/tsx/dist/cli.mjs server/scripts/verify-agent-commentary-live.ts
```
