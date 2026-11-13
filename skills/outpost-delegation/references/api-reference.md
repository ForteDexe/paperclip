# Delegation API

Read the roster and parent first:

```text
GET /api/companies/:spaceId/agents
GET /api/issues/:parentTaskId
```

Create the assigned child:

```text
POST /api/companies/:spaceId/issues
```

```json
{
  "title": "Implement mention autocomplete",
  "description": "Add keyboard-accessible agent suggestions in Campfire.",
  "status": "todo",
  "priority": "medium",
  "parentId": "00000000-0000-4000-8000-000000000201",
  "goalId": "00000000-0000-4000-8000-000000000202",
  "assigneeAgentId": "00000000-0000-4000-8000-000000000203"
}
```

Omit `goalId` when the parent has none. Every `...Id` in a request body must be
an internal UUID fetched from the API, never a display identifier or agent name.

A successful create returns `201` and the created task. Use that returned
identifier when linking it in the parent update.

