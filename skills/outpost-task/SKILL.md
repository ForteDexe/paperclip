---
name: outpost-task
description: Work on an assigned Outpost task by reading wake context, checking out the task, posting evidence-based updates, managing status, and finishing or reporting a blocker.
---

# Outpost Task

Use this skill for the task that woke you. A task has one durable owner; keep it
from start to finish unless the human explicitly changes ownership.

Internal API routes and environment variables retain legacy names: `issue`
means task, `company` means Space, and run context uses `OUTPOST_*` variables.

## Run context

Outpost injects `OUTPOST_AGENT_ID`, `OUTPOST_COMPANY_ID`,
`OUTPOST_TASK_ID`, `OUTPOST_RUN_ID`, `OUTPOST_API_URL`, and
`OUTPOST_API_KEY`. Use them exactly and never put the API key in content,
repository files, logs, or prompts.

Every mutating request includes:

```text
Authorization: Bearer $OUTPOST_API_KEY
X-Paperclip-Run-Id: $OUTPOST_RUN_ID
```

## Task loop

1. Read the wake payload. Fetch more history only when it is incomplete.
2. Check out the assigned task before changing it, unless this run already owns
   the checkout.
3. Work only inside the current Space and your assigned scope.
4. Verify the result proportionally to its risk.
5. Post a concise progress, blocker, or completion update. Do not repeat that
   update in the final CLI response.
6. Use `done` only for complete verified work. Use `blocked` only when a
   concrete dependency prevents progress.

Do not create subtasks or change ownership unless the human requests it. Use
`outpost-delegation` when a lead is asked to route work to another agent.

## Update helper

For multiline status updates, run the installed helper:

```bash
skill_dir="${CODEX_HOME:-$HOME/.codex}/skills/outpost-task"
bash "$skill_dir/scripts/outpost-task-update.sh" \
  --task-id "$OUTPOST_TASK_ID" \
  --status in_progress <<'MD'
Implemented the first part and verified the focused test.
MD
```

For Claude, use `$HOME/.claude/skills/outpost-task` as `skill_dir`.

Treat its JSON output as the receipt. An empty response or transport failure is
not success. The helper performs a bounded retry and verifies returned status.

Valid states: `backlog`, `todo`, `in_progress`, `in_review`, `done`, `blocked`,
and `cancelled`.

Read [references/api-reference.md](references/api-reference.md) for checkout,
comments, and status APIs. Read
[references/task-documents.md](references/task-documents.md) only when the user
asks for a durable task-local plan, report, or specification.

Use these separate skills when relevant:

- `outpost-decision` for a human choice or opinion.
- `outpost-artifact` for screenshots or files the human must inspect.
- `outpost-case` for a durable recurring investigation.
- `outpost-north-star` for long-term direction explicitly requested by the human.

