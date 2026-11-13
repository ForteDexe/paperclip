---
name: outpost-delegation
description: Route a requested feature or bug from an Outpost lead to the correct persistent scope owner without creating a multi-stage agent pipeline.
---

# Outpost Delegation

Use this skill only when the human asks a lead to delegate work or when the
assigned task explicitly requires a child task owned by another agent.

Delegation selects one durable owner. It does not create mandatory developer,
reviewer, and feedback stages. The human reviews final work; peers join only
when explicitly requested.

1. Read the Space roster and choose the agent whose durable scope matches the
   work. Do not choose by rank.
2. Read the parent task authoritatively.
3. Create one child task with the selected `assigneeAgentId` and the parent's
   internal `id`. Include the parent's internal `goalId` when present.
4. Keep the parent owned by the lead unless the human requested reassignment.
5. Record a concise parent update naming the delegated task and owner.

Read [references/api-reference.md](references/api-reference.md) for the exact
routes and payload. Do not create detailed subtask trees unless requested.

