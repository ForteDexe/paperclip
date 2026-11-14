# Outpost North Star

Outpost coordinates persistent AI agents and their work inside repository-backed
Spaces. It should make a small group of durable scope owners easy to understand,
route, and review without imposing a corporate hierarchy or a multi-agent
production line.

## Working model

```text
Space
|- Lead (optional coordination role)
|  |- Scope owner A
|  `- Scope owner B
`- Other peer agents

Feature or bug
-> A lead or the human chooses the appropriate scope owner
-> That agent owns the work from start to finish
-> Decisions pause for human input when needed
-> Campfire provides optional peer discussion
`-> The human reviews the result
```

## Product commitments

- A **Space** is the repository boundary and complete working context.
- One task has one durable agent owner. Delegation routes work; it does not
  create a mandatory developer/reviewer/feedback pipeline.
- Agent titles are free-form. Reporting relationships express coordination,
  not rank, and multiple root agents are peers.
- A Space may have one **default agent** as a routing preference. The default
  agent has no extra authority.
- The human remains the reviewer and decision maker. Decisions preserve a clear
  place to ask for input without reassigning the task.
- Campfire conversation does not change task ownership.
- Agent sessions remain bound to the Space working directory where they were
  created and continue across follow-up turns.
- Results remain attached to their tasks through comments, documents,
  screenshots, and artifacts.

## Compatibility vocabulary

The inherited implementation still uses `space`, `project`, `issue`,
`board`, and `outpost` in database fields, API routes, environment variables,
protocol identifiers, and package names. Those are compatibility terms, not
the product vocabulary. New user-facing and agent-facing copy uses **Space**,
**task**, **human/user**, and **Outpost**.
