---
name: outpost-task-record
description: Create or maintain the living structured Task Record for work whose intent, agreed outcomes, feature states, constraints, decisions, and next step must survive task turns. Use when a chat intent is clear enough to name a task and detailed briefing is about to begin, or whenever an assigned task has a Task Record; do not use for casual questions, ordinary one-step status updates, or append-only review history.
---

# Outpost Task Record

The Task Record is structured task data exposed through the dedicated Task
Record API. It is the current source of truth, not a transcript, an upfront
architecture plan, or agent-authored Markdown. Markdown shown in assignments
and the UI is generated from these fields.

## Before task creation

Keep a discussion in ordinary chat while the user is still establishing the
basic intent. Once the intent is clear enough to name one coherent task and the
discussion is about to expand into detailed features, behaviors, constraints,
or implementation choices, suggest creating the task. Do not wait for every
success criterion or feature outcome to be settled; a long unrecorded briefing
is more likely to drift.

Unless the user has already authorized both task creation and immediate
execution, propose the task with `status: "backlog"`. Seed its Task Record with
the settled intent and any scope already known, pass it as
`initialTaskRecord`, and use empty arrays plus `nextStep: null` for unknown
sections rather than inventing facts. Acceptance creates a parked task without waking its assignee.
Continue the detailed briefing in that task's conversation and update the
Record as information becomes settled. Use `status: "todo"` only when the
brief is sufficiently actionable and execution is already authorized.

A recommendation to create a task is not authorization. Use `suggest_tasks`
when the user has not explicitly authorized creation. If the user explicitly
asks to create the briefing task, use `create_task` directly with backlog
status.

Do not attach the record to the conversation task and do not create a local
`WORKING_SPEC.md`. The record belongs to the concrete task that will execute
the work. Use `initialPlan` separately when remaining execution steps also need
to be preserved.

## After task creation

The current Task Record is included in the assignment when one exists. Treat
that revision as authoritative context. Before writing, read the dedicated
`GET /api/issues/{taskId}/task-record` endpoint through `call_api` if the
assignment may be stale. Update it through the matching `PUT` endpoint with
the full structured Record and current `latestRevisionId` as `baseRevisionId`.
On a revision conflict, read the new revision, reconcile both changes, and
retry; never overwrite another update blindly. Do not use `read_document` or
`write_document` for the Task Record.

Update the record automatically when task discussion or actual work clearly adds,
removes, or changes an agreed behavior, constraint, decision, feature state,
or recommended next step. Keep the agreed outcome distinct from whether
implementation has been validated.

When a resolved choice changes user-visible behavior, create or update the
corresponding Features and Behaviors row. Do not append duplicate rows or keep
the superseded outcome as history. Use a Decisions section only for current
cross-cutting choices that do not belong in a feature outcome or constraint.

Maintain these fields:

- Intent
- Features and Behaviors: stable id, behavior, agreed outcome, and state
- Constraints and Non-Goals: an array, empty when none are settled
- Decisions: an array of optional cross-cutting choices only
- Next Step: a feature id and optional comment, or `null`
- Results and Verification: an array, empty until concrete results exist

Questions and answers belong in chat or task interactions, not in the Record.
Ask there and pause execution when a missing answer blocks progress. Once the
answer is settled, update the corresponding feature outcome, constraint, or
cross-cutting decision; do not copy the question transcript into the Record.

When there is an immediate action, set Next Step's `featureId` to the stable id
of that feature and add `comment` only when useful. Do not copy the feature
State into Next Step; consumers derive it from the feature. Set Next Step to
`null` when no feature has an immediate action.

Add Results and Verification items only when concrete runtime or test results
exist and are useful to the current task. They are not a per-feature
requirement; leave the array empty instead of adding placeholder content.

Feature state values are `agreed`, `testing`, `validated`, `implemented`, and
`skipped_by_agreement`. Replace stale conclusions instead of preserving a
history of abandoned directions. Keep speculative architecture, debugging
transcripts, routine progress chatter, and review history elsewhere.

Read [references/new-tool-workflow.md](references/new-tool-workflow.md) only for
a genuinely new standalone tool or production workflow. Read
[references/api-reference.md](references/api-reference.md) for exact structured
tool and API calls.
