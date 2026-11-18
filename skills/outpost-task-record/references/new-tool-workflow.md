# New Tool Development Workflow

Use this workflow only for a genuinely new standalone tool or production
workflow. Do not apply it to ordinary debugging, maintenance, refactors, or
small feature changes.

The goals are to prove the useful workflow with representative production data
and to keep the task's structured Task Record current with the features and
behaviors agreed during discussion. The record is not an upfront implementation
plan: do not predict classes, functions, files, or architecture before the
useful behavior is understood.

## Establish the task, then choose the production destination

Once the new tool's basic intent is clear, suggest or create a backlog task and
seed its Task Record. Continue the detailed briefing in that task's
conversation. Before implementation starts:

1. Inspect nearby production tools and relevant package boundaries.
2. Recommend one concrete production destination and briefly explain why it
   fits.
3. Confirm the location with the user when choosing differently would
   materially change ownership or architecture.
4. Record the confirmed destination under Constraints or Decisions in the
   Task Record.

Do not create a placeholder tool folder or a local `WORKING_SPEC.md`. The Task
Record lives in Outpost's database as revisioned structured data. Once the task
starts, disposable prototypes and probes may live in `.experiment` within the
task's execution workspace; production implementation belongs in the confirmed
production destination.

## Working flow

For each feature or behavior:

1. Clarify what the user expects, relevant inputs and outputs, and meaningful
   constraints or non-goals. Once clear, update the Task Record without waiting
   for a separate documentation request.
2. When uncertainty warrants it, use the smallest experiment that can prove
   the behavior. Prefer representative production data and validate host or
   engine behavior in the real host. Keep disposable logic in `.experiment`.
3. Implement the production behavior from the validated approach. Simple,
   understood behavior may go directly to focused implementation and testing.
4. Record the resulting feature state. Add concrete results or verification
   only after they exist. If a result changes the agreed behavior, discuss that
   change and update the outcome before continuing.

Experiments and implementation stages are working details, not approval gates.
Pause only when missing information, an external action, or a decision could
materially change the required result.

## Agent responsibility

- At the start of each task turn, read the injected Task Record and identify
  the current agreed behavior and next step.
- Update it when discussion or observed results change a feature, decision,
  state, or next step; do not wait to be asked.
- Put a behavior-changing decision into the corresponding feature outcome.
  Use Decisions only for current cross-cutting choices that do not map to a
  feature or constraint.
- Anchor Next Step to the stable id of the feature with the immediate action.
  Add an optional comment, but do not duplicate the feature state there.
- Ask questions in chat or task interactions. After an answer is settled,
  update the affected feature, constraint, or cross-cutting decision instead
  of storing the question in the Task Record.
- Point out conflicts with an agreed behavior and ask which direction replaces
  it.
- Keep implementation details out unless they are part of the user-visible
  contract or a real constraint.
- Keep the record short and current. Remove stale conclusions.

When all behaviors are implemented and validated or explicitly skipped, delete
`.experiment`. Retain the final Task Record with the task as a durable execution
record. Move stable operator instructions into the production tool's README
only when they are genuinely needed; do not duplicate the whole record there.
