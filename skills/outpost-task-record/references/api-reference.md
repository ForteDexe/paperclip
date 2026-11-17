# Task Record API

Use the native tools when available. The Task Record always uses key
`working-spec` and title `Task Record`.

## Persist with a task

Pass the complete Markdown record as `initialWorkingSpec` to `create_task`.
For an accepted `suggest_tasks` proposal, use the same field on each proposed
task that needs a record. It is persisted in the same transaction as the task,
before execution can start.

```json
{
  "idempotencyKey": "create-parser-task-v1",
  "title": "Build the agreed parser",
  "description": "Implement and verify the parser behavior agreed in chat.",
  "status": "todo",
  "initialWorkingSpec": "# Parser\n\n## Intent\nBuild the agreed parser behavior.\n\n## Features and Behaviors\n| Feature or behavior | Agreed outcome | State | Evidence |\n| --- | --- | --- | --- |\n| Parse input | Return normalized records. | Agreed | |\n\n## Next Step\nImplement the focused parser test."
}
```

The REST task-creation schema also accepts `initialWorkingSpec` on
`POST /api/spaces/{spaceId}/issues`.

## Read and update

Use `read_document` with:

```json
{"key":"working-spec"}
```

Then use `write_document` with a stable idempotency key and the returned
revision id:

```json
{
  "idempotencyKey": "task-record-validated-parser-v1",
  "key": "working-spec",
  "title": "Task Record",
  "body": "# Parser\n\n## Status\n**Validated**",
  "baseRevisionId": "00000000-0000-4000-8000-000000000001",
  "changeSummary": "Record validated parser behavior"
}
```

## Create

For a legacy runner, create the document with
`PUT /api/issues/{taskId}/documents/working-spec`:

```json
{
  "title": "Task Record",
  "format": "markdown",
  "body": "# Parser\n\n## Intent\nBuild the agreed parser behavior.",
  "changeSummary": "Create initial Task Record",
  "baseRevisionId": null
}
```

Add bearer authorization, `X-Outpost-Run-Id`, and `Content-Type:
application/json`. Read the current document first for later updates and send
its `latestRevisionId` as `baseRevisionId`. A `409` requires reconciliation.
Verify the returned key, body, and revision before claiming the write succeeded.
