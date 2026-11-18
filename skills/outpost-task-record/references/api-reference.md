# Task Record API

The Task Record uses structured fields. Never author or persist its Markdown
projection directly.

## Persist with a task

Pass the complete structured record as `initialTaskRecord` to `create_task`.
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
  "initialTaskRecord": {
    "version": 1,
    "intent": "Build a parser that returns normalized records.",
    "features": [{
      "id": "parse_input",
      "behavior": "Parse input",
      "outcome": "Return normalized records.",
      "state": "agreed"
    }],
    "constraintsAndNonGoals": [],
    "decisions": [],
    "nextStep": null,
    "resultsAndVerification": []
  }
}
```

The REST task-creation schema also accepts `initialTaskRecord` on
`POST /api/spaces/{spaceId}/issues`.

## Read and update

Use `search_api` to resolve the dedicated Task Record operations when needed,
then use `call_api` for:

- `GET /api/issues/{taskId}/task-record`
- `PUT /api/issues/{taskId}/task-record`

Read the current revision with:

```json
{
  "operationId": "GET /api/issues/{id}/task-record",
  "pathParams": { "id": "task-id" }
}
```

The update call contains the full record and the returned revision id:

```json
{
  "operationId": "PUT /api/issues/{id}/task-record",
  "pathParams": { "id": "task-id" },
  "body": {
    "record": {
      "version": 1,
      "intent": "Build a parser that returns normalized records.",
      "features": [{
        "id": "parse_input",
        "behavior": "Parse input",
        "outcome": "Return normalized records.",
        "state": "validated"
      }],
      "constraintsAndNonGoals": [],
      "decisions": [],
      "nextStep": null,
      "resultsAndVerification": ["Focused parser tests pass."]
    },
    "baseRevisionId": "00000000-0000-4000-8000-000000000001",
    "changeSummary": "Record validated parser behavior"
  }
}
```

For direct REST calls, add bearer authorization, `X-Outpost-Run-Id`, and
`Content-Type: application/json`. Read the current Record first for later
updates and send its `latestRevisionId` as `baseRevisionId`. A `409` requires
reconciliation. Verify the returned Record fields and revision before claiming
the write succeeded. Generic document endpoints intentionally reject
`working-spec`.
