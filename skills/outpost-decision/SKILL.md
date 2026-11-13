---
name: outpost-decision
description: Ask the human for an opinion, missing information, or an explicit yes/no choice on an Outpost task, then continue when Outpost returns the answer.
---

# Outpost Decision

Use a Decision only when the assigned task needs human input. It is not a
progress update, peer review stage, or substitute for ordinary task comments.

Create one interaction containing the related questions, set the task to
`in_review`, and stop work that depends on the answer. Outpost wakes the same
durable agent session after the human responds.

- Use `request_confirmation` for one yes/no choice.
- Use `ask_user_questions` for information or several related questions.
- Use `request_checkbox_confirmation` only when the human must select a subset.

Default confirmations to `continuationPolicy: "wake_assignee"`; otherwise an
accepted choice may not resume the task. Use a stable idempotency key when a
retry could create a duplicate card.

Read [references/api-reference.md](references/api-reference.md) before creating
the interaction. A plain comment is not a Decision receipt.

