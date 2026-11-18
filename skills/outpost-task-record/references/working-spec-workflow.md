# Serious Tool and Workflow Development

Use this workflow after the user agrees when a new tool, or a change to an
existing tool or workflow, has more than about three or four features or
behaviors, or enough uncertainty that experiments would help. Do not apply it
to simple patches, quick fixes, or ordinary debugging.

The Task Record is Outpost's database-backed equivalent of a temporary
`WORKING_SPEC.md`. It preserves current requirements across task turns without
creating a local duplicate. It is not an upfront implementation plan: do not
predict classes, functions, files, or architecture before the useful behavior
is understood.

## Choose the production destination

For an existing tool, use its root as the production destination. For a new
tool:

1. Inspect nearby production tools and relevant package boundaries.
2. Recommend one concrete destination and briefly explain why it fits.
3. Ask the user to confirm it when a different location would materially
   change ownership or architecture.
4. Record the confirmed destination as a constraint or cross-cutting decision.

Do not create a placeholder folder or local `WORKING_SPEC.md`. Disposable
prototypes and probes may live in `.experiment` inside the task's execution
workspace. Production implementation stays outside `.experiment`.

## Work feature by feature

For each feature or behavior:

1. Clarify the expected outcome, relevant inputs and outputs, and meaningful
   constraints or non-goals. Once clear, update the Record without waiting for
   a separate documentation request.
2. When uncertainty warrants it, use the smallest experiment that can prove
   the behavior. Prefer representative production data and validate host or
   engine behavior in the real host. Keep disposable logic and evidence in
   `.experiment`.
3. Implement the production behavior from the validated approach. Simple,
   understood behavior may go directly to implementation with focused
   validation.
4. Update the feature state and Validation. Point Validation to the run,
   `.experiment` output, or focused test that proved it; leave it empty until a
   run exists. If the result changes the agreed outcome, discuss the change and
   update the requirement before continuing.

Experiments and implementation stages are working details, not approval gates.
Do not repeatedly ask for confirmation after each small step. Pause only when
missing information, an external action, or a decision could materially change
the required result.

## Keep the Record current

- Read it at the start of a new session and summarize agreed behaviors,
  unresolved questions, and the recommended next step.
- Update existing entries when requirements change; remove stale conclusions
  instead of keeping an abandoned history.
- Keep unresolved decisions in Open Questions. Ask them in chat; after an
  answer, remove the question and update the affected requirement or decision.
- Put a behavior-changing decision in the corresponding feature outcome. Use
  Decisions only for cross-cutting choices that do not map to a feature or
  constraint.
- Anchor Next Step to the stable feature id and use its comment for the single
  recommended action.
- Keep representative inputs and known-good references in the relevant feature
  outcome, constraint, or validation rather than inventing a separate plan.
- Keep implementation details out unless they are part of the user-visible
  contract or a real constraint.

When every feature is implemented with validation or explicitly skipped,
remove `.experiment`. Move stable operator instructions into the production
tool's README only when genuinely needed. Outpost retains the final Record and
its revisions with the task as execution history; do not create duplicate
permanent documentation from it.
