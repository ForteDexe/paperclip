---
name: outpost-task-record
description: Create or maintain the living Task Record for work whose intent, agreed outcomes, feature states, constraints, decisions, and next step must survive task turns. Use when a chat intent is clear enough to name a task and detailed briefing is about to begin, or whenever an assigned task has a working-spec document; do not use for casual questions, ordinary one-step status updates, or append-only review history.
---

# Outpost Task Record

The Task Record is the task document with key `working-spec` and title
`Task Record`. It is the current source of truth, not a transcript or an
upfront architecture plan.

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
`initialWorkingSpec`, and omit unknown sections rather than inventing
placeholders. Acceptance creates a parked task without waking its assignee.
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
that revision as authoritative context. Before writing, use `read_document`
with key `working-spec` if the assignment may be stale. Update it with
`write_document`, using the current revision id as `baseRevisionId`. On a
revision conflict, read the new revision, reconcile both changes, and retry;
never overwrite another update blindly.

Update the record automatically when task discussion or actual work clearly adds,
removes, or changes an agreed behavior, constraint, decision, feature state,
or recommended next step. Keep the agreed outcome distinct from whether
implementation has been validated.

When a resolved choice changes user-visible behavior, create or update the
corresponding Features and Behaviors row. Do not append duplicate rows or keep
the superseded outcome as history. Use a Decisions section only for current
cross-cutting choices that do not belong in a feature outcome or constraint.

Use this compact structure as needed:

- Intent
- Features and Behaviors: behavior, agreed outcome, and state
- Constraints and Non-Goals
- Decisions: optional cross-cutting choices only
- Next Step: optional feature reference and optional comment

Questions and answers belong in chat or task interactions, not in the Record.
Ask there and pause execution when a missing answer blocks progress. Once the
answer is settled, update the corresponding feature outcome, constraint, or
cross-cutting decision; do not copy the question transcript into the Record.

When there is an immediate action, record its exact `Feature or behavior` name
under Next Step and add a `Comment` only when useful. Do not copy the feature
State into Next Step; consumers derive it from the feature row. Omit Next Step
when no feature has an immediate action.

Add a Results and Verification section only when concrete runtime or test
results exist and are useful to the current task. It is optional, is not a
per-feature requirement, and must not be prefilled with placeholder content.

Useful feature states are `Agreed`, `Testing`, `Validated`, `Implemented`, and
`Skipped by agreement`. Replace stale conclusions instead of preserving a
history of abandoned directions. Keep speculative architecture, debugging
transcripts, routine progress chatter, and review history elsewhere.

Read [references/new-tool-workflow.md](references/new-tool-workflow.md) only for
a genuinely new standalone tool or production workflow. Read
[references/api-reference.md](references/api-reference.md) for exact native and
legacy API calls.
