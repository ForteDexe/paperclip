---
name: outpost-task-record
description: Create or maintain a structured Task Record for a serious tool or workflow task with several behaviors or enough uncertainty to need experiments. Use after the user agrees to the workflow, or whenever an assigned task already has a Task Record. Do not use for simple patches, quick fixes, routine debugging, casual questions, or append-only review history.
---

# Outpost Task Record

The Task Record is structured task data exposed through the dedicated Task
Record API. It is the current source of truth, not a transcript, an upfront
architecture plan, or agent-authored Markdown. Markdown shown in assignments
and the UI is generated from these fields.

## Decide when to use a Record

Suggest this workflow when a new tool or a change to an existing tool or
workflow has more than about three or four features or behaviors, or when the
behavior is uncertain enough that experiments would help. Use it once the user
agrees. Simple patches, quick fixes, and ordinary debugging do not need a
Record merely because they are tasks.

Keep the discussion in ordinary chat while the basic intent is still unclear.
For a serious task, propose a backlog task and its Record before a long detailed
brief drifts. The user may agree while feature outcomes, constraints, or open
questions are still incomplete.

Unless the user has already authorized both task creation and immediate
execution, propose the task with `status: "backlog"`. Seed its Task Record with
the settled intent and any scope already known, pass it as
`initialTaskRecord`, and use empty arrays plus `nextStep: null` for unknown
sections rather than inventing facts. Acceptance creates a parked task without
waking its assignee.
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

At the start of a new task session, read the current Record and briefly
summarize the agreed behaviors, unresolved questions, and recommended next
step. Update the Record automatically when discussion or work clearly adds,
removes, or changes an agreed behavior, constraint, decision, question,
feature state, validation, or recommended next step. Keep the agreed outcome
distinct from whether an implementation has been validated.

When a resolved choice changes user-visible behavior, create or update the
corresponding Features and Behaviors row. Do not append duplicate rows or keep
the superseded outcome as history. Use a Decisions section only for current
cross-cutting choices that do not belong in a feature outcome or constraint.

Maintain these fields:

- Intent
- Features and Behaviors: stable id, behavior, agreed outcome, state, and optional validation
- Constraints and Non-Goals: an array, empty when none are settled
- Decisions: an array of optional cross-cutting choices only
- Open Questions: unresolved decisions only; remove an item when it is settled
- Next Step: a feature id and optional comment, or `null`
- Results and Verification: cross-cutting review evidence, empty until concrete results exist

Ask questions in chat or task interactions and pause when a missing answer
blocks progress. Keep only unresolved questions in Open Questions, not the
transcript or agent assumptions. Once an answer is settled, remove the question
and update the corresponding feature outcome, constraint, or cross-cutting
decision.

When there is an immediate action, set Next Step's `featureId` to the stable id
of that feature and add `comment` only when useful. Do not copy the feature
State into Next Step; consumers derive it from the feature. Set Next Step to
`null` when no feature has an immediate action.

Fill a feature's Validation only after a run. Point to the experiment output or
test that proved it, or say what was not run. Keep it `null` until then. Use
Results and Verification only for useful cross-cutting review evidence; do not
duplicate every feature validation there.

Feature state values are `agreed`, `testing`, `validated`, `implemented`, and
`skipped_by_agreement`. Replace stale conclusions instead of preserving a
history of abandoned directions. Keep speculative architecture, debugging
transcripts, routine progress chatter, and review history elsewhere.

For serious implementation work, read
[references/working-spec-workflow.md](references/working-spec-workflow.md).
Read
[references/api-reference.md](references/api-reference.md) for exact structured
tool and API calls.
