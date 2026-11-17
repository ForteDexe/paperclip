# Task Record API

Use the native tools when available. The Task Record always uses key
`working-spec` and title `Task Record`.

## Persist with a task

Pass the complete Markdown record as `initialWorkingSpec` to `create_task`.
For an accepted `suggest_tasks` proposal, use the same field on each proposed
task that needs a record. Use `status: "backlog"` when the task is being created
early so its detailed brief can be developed without starting execution. The
record is persisted in the same transaction as the task. Use `status: "todo"`
only when execution is already authorized and the brief is actionable.

```json
{
  "idempotencyKey": "create-parser-task-v1",
  "title": "Build the agreed parser",
  "description": "Develop the parser brief in the task conversation, then implement it when resumed.",
  "status": "backlog",
  "initialWorkingSpec": "# Parser\n\n## Intent\nBuild a parser that returns normalized records.\n\n## Features and Behaviors\n| Feature or behavior | Agreed outcome | State |\n| --- | --- | --- |\n| Parse input | Return normalized records. | Agreed |"
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
  "body": "# Parser\n\n## Features and Behaviors\n| Feature or behavior | Agreed outcome | State |\n| --- | --- | --- |\n| Parse input | Return normalized records. | Validated |\n\n## Results and Verification\n- Focused parser tests pass.",
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
