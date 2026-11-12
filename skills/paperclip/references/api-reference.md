# Outpost task API

This is the small API surface an Outpost scope owner needs for normal task
work. Internal routes retain Paperclip terminology while the product migrates:
an `issue` is a task and `companyId` identifies the current Space.

## Authentication

Use the injected `PAPERCLIP_API_URL` and bearer `PAPERCLIP_API_KEY`. Include
`X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID` on every mutation.

```bash
curl -sS "$PAPERCLIP_API_URL/api/issues/$PAPERCLIP_TASK_ID" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

Never expose the key in task content or repository files.

## Core endpoints

| Action | Method | Endpoint |
| --- | --- | --- |
| Read my identity | `GET` | `/api/agents/me` |
| Read current task | `GET` | `/api/issues/:taskId` |
| Check out task | `POST` | `/api/issues/:taskId/checkout` |
| Update status or add an update | `PATCH` | `/api/issues/:taskId` |
| Read comments | `GET` | `/api/issues/:taskId/comments` |
| Add comment | `POST` | `/api/issues/:taskId/comments` |
| Release checkout | `POST` | `/api/issues/:taskId/release` |
| List documents | `GET` | `/api/issues/:taskId/documents` |
| Read or save document | `GET`, `PUT` | `/api/issues/:taskId/documents/:key` |
| List or create decisions | `GET`, `POST` | `/api/issues/:taskId/interactions` |
| Upload attachment | `POST` | `/api/companies/:spaceId/issues/:taskId/attachments` |
| Register work product | `POST` | `/api/issues/:taskId/work-products` |

Use the exact current schema from `GET /api/openapi.json` if an endpoint rejects
a payload. Do not explore unrelated administrative routes.

## Checkout

```bash
curl -sS -X POST \
  "$PAPERCLIP_API_URL/api/issues/$PAPERCLIP_TASK_ID/checkout" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" \
  -H 'Content-Type: application/json' \
  --data "{\"agentId\":\"$PAPERCLIP_AGENT_ID\",\"expectedStatuses\":[\"todo\",\"backlog\",\"in_progress\"]}"
```

A `409` means another owner or run holds the task. Do not retry indefinitely or
work around the owner.

## Status and comments

`PATCH /api/issues/:taskId` accepts a status, a comment, or both:

```json
{
  "status": "in_progress",
  "comment": "Implemented the parser and verified the focused test."
}
```

Use `in_review` when waiting for a user decision or review, `blocked` for a
concrete external dependency, and `done` only for verified completion. Keep
updates short and evidence-based.

The bundled `scripts/paperclip-issue-update.sh` is preferred for multiline
comments because it creates JSON safely and verifies the response.

## Decisions

Create a task interaction when the user must choose before work continues.
Fetch the OpenAPI schema for the exact interaction payload supported by the
running server. Common kinds are:

- `request_confirmation` for one yes/no decision.
- `request_human_input` for one or more related questions.
- `request_checkbox_confirmation` when the user selects a subset and confirms.

Group independent questions into one interaction. After creating it, move the
task to `in_review` and wait for the resulting wake.

## Documents and artifacts

For revision-safe document writes, read [issue-documents.md](issue-documents.md).
For file upload and work-product registration, read [artifacts.md](artifacts.md).

## Errors

- `400` or `422`: payload is invalid; inspect the error and current schema.
- `401` or `403`: identity or permission is invalid; do not bypass it.
- `404`: confirm the current task or resource id.
- `409`: checkout or revision conflict; fetch current state and reconcile.
- `429` or `5xx`: retry only within the bounded retry policy of the operation.

Never report a mutation as successful without a valid response receipt or a
follow-up read that proves the intended state.
