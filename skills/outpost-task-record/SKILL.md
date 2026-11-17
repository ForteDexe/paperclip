---
name: outpost-task-record
description: Create or maintain the living Task Record for work whose agreed outcomes, feature states, evidence, questions, and next step must survive task turns. Use before creating a task from clarified discussion or whenever an assigned task has a working-spec document; do not use for ordinary one-step status updates or append-only review history.
---

# Outpost Task Record

The Task Record is the task document with key `working-spec` and title
`Task Record`. It is the current source of truth, not a transcript or an
upfront architecture plan.

## Before task creation

Once the intended outcome and meaningful success criteria are clear, draft the
Task Record and pass it as `initialWorkingSpec` when creating the task. This
persists it transactionally before a `todo` task can wake its assignee.

Do not attach the record to the conversation task and do not create a local
`WORKING_SPEC.md`. The record belongs to the concrete task that will execute
the work. Use `initialPlan` separately when remaining execution steps also need
to be preserved.

## During an active task

The current Task Record is included in the assignment when one exists. Treat
that revision as authoritative context. Before writing, use `read_document`
with key `working-spec` if the assignment may be stale. Update it with
`write_document`, using the current revision id as `baseRevisionId`. On a
revision conflict, read the new revision, reconcile both changes, and retry;
never overwrite another update blindly.

Update the record automatically when discussion or evidence clearly adds,
removes, or changes an agreed behavior, constraint, decision, feature state,
open question, or recommended next step. Keep the agreed outcome distinct from
whether implementation has been validated.

Use this compact structure as needed:

- Intent
- Features and Behaviors: behavior, agreed outcome, state, and evidence
- Constraints and Non-Goals
- Decisions
- Open Questions: unresolved items only
- Status
- Evidence and Results
- Next Step: one recommended action

Useful feature states are `Agreed`, `Testing`, `Validated`, `Implemented`, and
`Skipped by agreement`. Replace stale conclusions instead of preserving a
history of abandoned directions. Keep speculative architecture, debugging
transcripts, routine progress chatter, and review history elsewhere.

Read [references/new-tool-workflow.md](references/new-tool-workflow.md) only for
a genuinely new standalone tool or production workflow. Read
[references/api-reference.md](references/api-reference.md) for exact native and
legacy API calls.
