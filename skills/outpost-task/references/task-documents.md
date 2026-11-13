# Task documents

Use task documents for requested plans, reports, specifications, or other
durable Markdown that belongs with an Outpost task. Honor a different
destination when the user explicitly chooses one.

## Create

```text
PUT /api/issues/{taskId}/documents/{key}
```

```json
{
  "title": "Task report",
  "format": "markdown",
  "body": "# Task report\n\nThe requested findings.",
  "baseRevisionId": null
}
```

Keys use lowercase letters, numbers, underscores, or hyphens and are at most 64
characters. Use `plan` for plans. Include bearer authorization,
`X-Paperclip-Run-Id`, and `Content-Type: application/json`.

A successful creation returns `201`; an update returns `200`. Verify the
returned key, body, and `latestRevisionId` before claiming delivery.

## Update safely

Read the current document first. Send its `latestRevisionId` as the next
request's `baseRevisionId`. On `409`, fetch the new revision and reconcile the
content; never overwrite another update blindly.

If a write result is unclear, read the document and verify its saved revision
before retrying.

## Link

Link the saved document in the task update:

```text
/<task-prefix>/issues/<task-identifier>#document-<key>
```

For an unnumbered task, use `/issues/<task-id>#document-<key>`.
