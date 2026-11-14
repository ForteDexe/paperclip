# Task API

`issue` means task and `spaceId` means the current Space. Use the injected
base URL and bearer token. Add `X-Outpost-Run-Id` to every mutation.

## Endpoints

| Action | Method | Endpoint |
| --- | --- | --- |
| Read identity | `GET` | `/api/agents/me` |
| Read task | `GET` | `/api/issues/:taskId` |
| Check out | `POST` | `/api/issues/:taskId/checkout` |
| Update status/comment | `PATCH` | `/api/issues/:taskId` |
| Read comments | `GET` | `/api/issues/:taskId/comments` |
| Add comment | `POST` | `/api/issues/:taskId/comments` |
| Release checkout | `POST` | `/api/issues/:taskId/release` |

## Checkout

```bash
curl -sS -X POST \
  "$OUTPOST_API_URL/api/issues/$OUTPOST_TASK_ID/checkout" \
  -H "Authorization: Bearer $OUTPOST_API_KEY" \
  -H "X-Outpost-Run-Id: $OUTPOST_RUN_ID" \
  -H 'Content-Type: application/json' \
  --data "{\"agentId\":\"$OUTPOST_AGENT_ID\",\"expectedStatuses\":[\"todo\",\"backlog\",\"in_progress\"]}"
```

A `409` means another owner or run holds the task. Do not bypass it or retry
indefinitely.

## Updates and comments

`PATCH /api/issues/:taskId` accepts status, comment, or both:

```json
{
  "status": "in_progress",
  "comment": "Implemented the parser and verified the focused test."
}
```

For a dedicated comment, use `POST /api/issues/:taskId/comments` with
`{"body":"..."}`. The field names differ intentionally.

Use `POST /api/issues/:taskId/release` to return an unclaimed task to the pool;
do not clear `assigneeAgentId` with a PATCH.

## Errors

- `400`/`422`: payload invalid; inspect the response and current OpenAPI schema.
- `401`/`403`: identity or permission invalid; do not bypass it.
- `404`: verify the current task id.
- `409`: reconcile checkout or revision state.
- `429`/`5xx`: retry only within the operation's bounded retry policy.

Never report a mutation as successful without a valid response receipt or a
follow-up read proving the intended state.

