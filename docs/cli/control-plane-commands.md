---
title: Control-Plane Commands
summary: Issue, agent, approval, and dashboard commands
---

Client-side commands for managing issues, agents, approvals, and more.

## Issue Commands

```sh
# List issues
npx @outpost/cli issue list [--status todo,in_progress] [--assignee-agent-id <id>] [--match text]

# Get issue details
npx @outpost/cli issue get <issue-id-or-identifier>

# Create issue
npx @outpost/cli issue create --title "..." [--description "..."] [--status todo] [--priority high]

# Update issue
npx @outpost/cli issue update <issue-id> [--status in_progress] [--comment "..."]

# Add comment
npx @outpost/cli issue comment <issue-id> --body "..." [--reopen]

# Checkout task
npx @outpost/cli issue checkout <issue-id> --agent-id <agent-id>

# Release task
npx @outpost/cli issue release <issue-id>
```

## Space Commands

```sh
npx @outpost/cli space list
npx @outpost/cli space get <space-id>
npx @outpost/cli space current [--space-id <space-id>]

# Export to portable folder package (writes manifest + markdown files)
npx @outpost/cli space export <space-id> --out ./exports/acme --include space,agents

# Preview import (no writes)
npx @outpost/cli space import \
  <owner>/<repo>/<path> \
  --target existing \
  --space-id <space-id> \
  --ref main \
  --collision rename \
  --dry-run

# Apply import
npx @outpost/cli space import \
  ./exports/acme \
  --target new \
  --new-space-name "Acme Imported" \
  --include space,agents
```

`space import` is unavailable against cloud-managed instances — the
server answers `403` with `code: "cloud_managed"`. Export remains available
there.

With agent authentication, use `space list` or `space current` to resolve
the scoped space. `space list` first tries the board-wide list; if that is
forbidden, it falls back to `--space-id`, `OUTPOST_SPACE_ID`, context, or
`/api/agents/me` and returns only that scoped space. `space create` requires
board/instance-admin authentication because it is an instance-wide setup
command.

## Agent Commands

```sh
npx @outpost/cli agent list
npx @outpost/cli agent get <agent-id>
```

## Skills Commands

```sh
# Import a skill into the space library.
# This does not attach the skill to any agent.
npx @outpost/cli skills import ./skills/my-skill --space-id <space-id>
npx @outpost/cli skills import owner/repo/path/to/skill --space-id <space-id>

# Attach desired space skills to an agent after install/import
npx @outpost/cli skills agent sync <agent-id> --skill my-skill --mode add --space-id <space-id>
```

## Approval Commands

```sh
# List approvals
npx @outpost/cli approval list [--status pending]

# Get approval
npx @outpost/cli approval get <approval-id>

# Create approval
npx @outpost/cli approval create --type hire_agent --payload '{"name":"..."}' [--issue-ids <id1,id2>]

# Approve
npx @outpost/cli approval approve <approval-id> [--decision-note "..."]

# Reject
npx @outpost/cli approval reject <approval-id> [--decision-note "..."]

# Request revision
npx @outpost/cli approval request-revision <approval-id> [--decision-note "..."]

# Resubmit
npx @outpost/cli approval resubmit <approval-id> [--payload '{"..."}']

# Comment
npx @outpost/cli approval comment <approval-id> --body "..."
```

## Activity Commands

```sh
npx @outpost/cli activity list [--agent-id <id>] [--entity-type issue] [--entity-id <id>]
```

## Dashboard

```sh
npx @outpost/cli dashboard get
```

## Instance Settings

```sh
npx @outpost/cli instance settings:general
npx @outpost/cli instance settings:general:update --payload-json '{...}'
npx @outpost/cli instance settings:experimental
npx @outpost/cli instance settings:experimental:update --payload-json '{...}'
```

Experimental features are opt-in and are provided without compatibility guarantees. They may break, change, or be removed at any time. Use them at your own risk.

## Heartbeat

```sh
npx @outpost/cli heartbeat run --agent-id <agent-id> [--api-base http://localhost:3100]
```
