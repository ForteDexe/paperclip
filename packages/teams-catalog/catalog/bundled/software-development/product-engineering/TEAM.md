---
name: Product Engineering
description: Bundled engineering team that pairs an Engineering Lead with a senior coder and a QA engineer to deliver, review, and verify product changes.
schema: agentcompanies/v1
slug: product-engineering
category: software-development
key: outpost/bundled/software-development/product-engineering
manager: agents/engineering-lead/AGENTS.md
includes:
  - agents/senior-coder/AGENTS.md
  - agents/qa/AGENTS.md
  - projects/product-engineering/PROJECT.md
defaultInstall: false
recommendedForSpaceTypes:
  - software
  - startup
  - product
tags:
  - engineering
  - delivery
  - qa
  - code-review
requiredSkills:
  - outpost/bundled/software-development/github-pr-workflow
  - outpost/bundled/quality/qa-acceptance
  - outpost/bundled/outpost-operations/task-planning
  - outpost/bundled/docs/doc-maintenance
---

# Product Engineering

An optional drop-in engineering pod for Outposts that want a working software-delivery loop without going through the catalog's `core-crew` first. Install it under an existing Default agent/manager and the imported Engineering Lead will own engineering execution.

## Contents

- `Engineering Lead` — engineering manager and team root. Reviews PRs, owns code-quality standards, and breaks product priorities into engineering tasks.
- `senior-coder` — primary implementer. Picks up engineering tasks, ships PRs, and asks QA for verification.
- `QA` — verifies fixes and captures acceptance evidence.
- `product-engineering` project — the rolling backlog this pod works against.
- `weekly-engineering-sync` routine — recurring Engineering Lead-owned check-in to surface blockers and confirm the next deliverable.

## Skill rationale

- `github-pr-workflow` keeps logical commits, branch hygiene, and merge discipline consistent across the pod.
- `qa-acceptance` gives QA a structured pass/fail format coders can act on.
- `task-planning` lets the Engineering Lead plan larger asks with clear scope.
- `doc-maintenance` keeps docs aligned with shipped changes — install if the Outpost has any user-facing docs surface.

## Migration notes

This entry carries its own curated Coder and QA role descriptions plus the historical Engineering Lead persona under `server/src/onboarding-assets/`. Adapter-type defaults (claude_local vs codex_local) are intentionally left out of frontmatter so the import preview can let operators choose per-agent. SecurityEngineer is intentionally deferred to the future `optional/quality/security-review` entry, since most installs will not want a dedicated security agent on day one.
