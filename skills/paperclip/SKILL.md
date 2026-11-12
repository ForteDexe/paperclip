---
name: paperclip
description: >
  Work on an assigned Outpost task: read its context, perform the work in the
  current Space, post progress or blockers, save requested task documents, and
  upload requested files.
---

# Outpost Task Runtime

Use this skill only for the task that woke you. Outpost gives each agent a
durable scope and session; the task remains owned by that agent from start to
finish unless the user explicitly changes ownership.

`task` is the user-facing term. Internal API routes and environment variables
still use the legacy names `issue`, `company`, and `PAPERCLIP_*`.

## Run context

Outpost injects:

- `PAPERCLIP_AGENT_ID`
- `PAPERCLIP_COMPANY_ID` (the current Space's internal id)
- `PAPERCLIP_TASK_ID`
- `PAPERCLIP_RUN_ID`
- `PAPERCLIP_API_URL`
- `PAPERCLIP_API_KEY`

Use the injected values exactly. Never copy the API key into prompts, task
comments, documents, repository files, or logs. Every mutating API request must
include:

```text
Authorization: Bearer $PAPERCLIP_API_KEY
X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID
```

The wake prompt contains the current task and new messages. Read it before
fetching more history. Fetch the task or comments only when the wake payload is
incomplete or older context is needed.

## Task loop

1. Read the wake payload and identify the requested outcome.
2. Work only in the current Space's repository and your assigned scope.
3. Check out the task before changing it unless the wake payload explicitly
   says this exact task is already checked out for this run.
4. Do the work and verify the result proportionally to its risk.
5. Post a concise update when meaningful progress, a blocker, or completion
   occurs. Do not duplicate the same update in both Outpost and your final CLI
   response.
6. Set the task to `done` only when the requested outcome is complete. Use
   `blocked` only for a concrete dependency that prevents further progress.

Do not create subtasks or change ownership unless the user explicitly requests
that action. Campfire discussion does not change task ownership.

## Updating a task

Use the absolute installed skill directory supplied by the runtime. It is not
the task repository. If the runtime does not supply that location, use the API
directly instead of searching the filesystem:

```bash
bash "$paperclip_skill_dir/scripts/paperclip-issue-update.sh" \
  --issue-id "$PAPERCLIP_TASK_ID" \
  --status in_progress <<'MD'
Implemented the first part and verified the focused test.
MD
```

Valid task states are `backlog`, `todo`, `in_progress`, `in_review`, `done`,
`blocked`, and `cancelled`.

Treat the response body as the write receipt. An empty response or transport
failure is not success. The bundled helper performs a bounded retry and checks
the returned status.

## Human decisions

When work cannot continue without a user choice, create one task interaction
that contains the necessary questions together, then leave the task in
`in_review`. Do not simulate a decision with a plain comment. Continue after
Outpost wakes the same agent with the answer.

Use a confirmation for a yes/no decision and a question form for information.

## Task documents

When the user asks for a plan, report, specification, or other durable task
document, read [references/issue-documents.md](references/issue-documents.md).
Update an existing document revision-safely rather than overwriting it blindly.

## Generated files

When the user needs a generated file outside the agent workspace, read
[references/artifacts.md](references/artifacts.md) and use the bundled upload
helper. A local path alone is not delivery.

## API reference

For task, comment, document, interaction, and artifact endpoints, read
[references/api-reference.md](references/api-reference.md). It intentionally
contains only the task-runtime API surface.

## CLI safety

If an Outpost CLI command contains task text, Markdown, pasted content, or model
output, pass it as inert arguments with `npx paperclipai`. Do not use
`pnpm paperclipai` or `pnpm exec paperclipai` for content-bearing arguments.
