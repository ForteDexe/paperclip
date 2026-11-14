---
name: Core Crew
description: Default crew for bootstrapping an Outpost with a Default agent, Engineering Lead, QA Engineer, starter project, and a recurring lead heartbeat review task.
schema: agentcompanies/v1
slug: core-crew
category: space-defaults
key: outpost/bundled/space-defaults/core-crew
manager: agents/lead/AGENTS.md
includes:
  - agents/engineering-lead/AGENTS.md
  - agents/qa/AGENTS.md
  - projects/first-project/PROJECT.md
defaultInstall: true
recommendedForSpaceTypes:
  - startup
  - software
  - generalist
tags:
  - default
  - coordination
  - engineering
  - qa
requiredSkills:
  - outpost/bundled/outpost-operations/task-planning
  - outpost/bundled/outpost-operations/issue-triage
  - outpost/bundled/software-development/github-pr-workflow
  - outpost/bundled/quality/qa-acceptance
---

# Core Crew

The Core Crew is the bundled default install for a new Outpost. It boots the smallest crew that can take a prompt, plan it, implement it, and verify it.

## Contents

- `Default agent` — direction, prioritization, delegation. Uses `task-planning` and `issue-triage` to keep the inbox moving.
- `Engineering Lead` — technical execution and engineering oversight. Coordination lead the Default agent. Uses `github-pr-workflow` for code review and merge hygiene.
- `QA` — verifies fixes and captures evidence. Coordination lead the Engineering Lead. Uses `qa-acceptance` for structured acceptance reports.
- `first-project` — starter project under the Engineering Lead for converting the outpost North Star into the first implementation task.
- `first-heartbeat` — recurring lead heartbeat to review priorities and confirm the next useful task.

## Migration notes

This entry mirrors the historical `server/src/onboarding-assets/default-agent/` template family while staying inside the catalog package boundary. Each agent has a short role description in `AGENTS.md`. Runtime procedures come from the harness, repository instructions, and installed skills. Legacy persona files are not part of catalog imports.
