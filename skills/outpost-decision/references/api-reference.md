# Decision API

Create and list Decisions on the current task:

```text
POST /api/issues/:taskId/interactions
GET  /api/issues/:taskId/interactions
```

Use bearer authentication and `X-Paperclip-Run-Id` on the POST.

## Yes/no confirmation

```json
{
  "kind": "request_confirmation",
  "title": "Approve the UI direction",
  "summary": "The implementation depends on this choice.",
  "continuationPolicy": "wake_assignee",
  "idempotencyKey": "ui-direction-v1",
  "payload": {
    "version": 1,
    "prompt": "Should I use the compact layout?",
    "acceptLabel": "Use compact",
    "rejectLabel": "Keep current",
    "detailsMarkdown": "The compact layout keeps the task list visible."
  }
}
```

## Questions

```json
{
  "kind": "ask_user_questions",
  "title": "Choose the implementation details",
  "continuationPolicy": "wake_assignee",
  "idempotencyKey": "implementation-details-v1",
  "payload": {
    "version": 1,
    "questions": [
      {
        "id": "layout",
        "prompt": "Which layout should I implement?",
        "selectionMode": "single",
        "required": true,
        "options": [
          {"id": "compact", "label": "Compact"},
          {"id": "spacious", "label": "Spacious"}
        ]
      }
    ]
  }
}
```

After a successful `201` receipt, update the task to `in_review`. If creation
fails, do not claim that the human was asked.

