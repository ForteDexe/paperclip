# Space Skills Workflow

Use this reference when a board user, CEO, or manager asks you to find a skill, install it into the space library, or assign it to an agent.

## What Exists

- App-shipped catalog: a curated set of space skills in `@outpost/skills-catalog`, browseable and installable without leaving Outpost.
- Space skill library: install, inspect, update, audit, reset, and read space skills for the whole space.
- Agent skill assignment: add or remove space skills on an existing agent.
- Hire/create composition: pass `desiredSkills` when creating or hiring an agent so the same assignment model applies immediately.

The canonical model is:

1. add the skill to the space library — either from the app catalog (`skills install`), an external source (`skills import`), or a managed local skill (`skills create`/`skills scan-projects`)
2. attach the space skill to the agent (`skills agent sync`)
3. optionally do step 2 during hire/create with `desiredSkills`

Catalog install ≠ agent attach. Installing a catalog skill only adds the row to
`space_skills`. The agent will not use it until you sync the agent's desired
set.

## Permission Model

- Space skill reads: any same-space actor
- Space skill mutations: board, a human/agent principal with an explicit `skills:create` grant, or an agent whose `canCreateSkills` permission is enabled. `canCreateSkills` defaults on for agents unless explicitly disabled.
- Agent skill assignment: same permission model as updating that agent
- Team installs continue to require `agents:create` because they import or create agents in addition to attaching skills.

## Core Endpoints

App-shipped catalog (read-only browse + space install):

- `GET /api/skills/catalog`
- `GET /api/skills/catalog/:catalogId`
- `GET /api/skills/catalog/ref?ref=<id|key|slug>`
- `GET /api/skills/catalog/:catalogId/files?path=SKILL.md`
- `POST /api/spaces/:spaceId/skills/install-catalog`

Space library:

- `GET /api/spaces/:spaceId/skills`
- `GET /api/spaces/:spaceId/skills/:skillId`
- `GET /api/spaces/:spaceId/skills/:skillId/files?path=SKILL.md`
- `POST /api/spaces/:spaceId/skills` (managed local create)
- `POST /api/spaces/:spaceId/skills/import`
- `POST /api/spaces/:spaceId/skills/scan-projects`
- `GET /api/spaces/:spaceId/skills/:skillId/update-status`
- `POST /api/spaces/:spaceId/skills/:skillId/install-update`
- `POST /api/spaces/:spaceId/skills/:skillId/audit`
- `POST /api/spaces/:spaceId/skills/:skillId/reset`
- `DELETE /api/spaces/:spaceId/skills/:skillId`

Agent attach and hire/create composition:

- `GET /api/agents/:agentId/skills`
- `POST /api/agents/:agentId/skills/sync`
- `POST /api/spaces/:spaceId/agent-hires`
- `POST /api/spaces/:spaceId/agents`

If a board user, CEO, or manager is driving locally, prefer the
`outpost skills` CLI documented in `doc/CLI.md` — it wraps every endpoint
above, accepts space skill or catalog refs by `id`/`key`/`slug`, and prints
the same JSON these endpoints return when called with `--json`.

## Install A Skill Into The Space

Two paths cover the common cases:

1. **App-shipped catalog** (preferred when the right skill exists in the
   bundled/optional catalog) — browse it first, then install with the catalog
   install endpoint. No external network fetch happens.
2. **External source** (skills.sh, GitHub, local path, or URL) — use the
   import endpoint below.

### App-shipped catalog

Browse, inspect, and install catalog skills before reaching for an external
source. Bundled skills are the curated defaults for any space; optional
skills are role- or domain-specific.

```sh
curl -sS "$OUTPOST_API_URL/api/skills/catalog?kind=bundled" \
  -H "Authorization: Bearer $OUTPOST_API_KEY"

curl -sS "$OUTPOST_API_URL/api/skills/catalog/ref?ref=github-pr-workflow" \
  -H "Authorization: Bearer $OUTPOST_API_KEY"

curl -sS -X POST "$OUTPOST_API_URL/api/spaces/$OUTPOST_SPACE_ID/skills/install-catalog" \
  -H "Authorization: Bearer $OUTPOST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "catalogSkillId": "outpost:bundled:software-development:github-pr-workflow"
  }'
```

The install response records provenance (`catalogId`, `catalogKey`,
`packageVersion`, `originHash`) on the space skill so update/audit/reset
flows know the pinned origin. `force: true` may replace a same-key
catalog-managed skill but never bypasses hard-stop audit findings.

### External source import

Import using a **skills.sh URL**, a key-style source string, a GitHub URL, or a local path.

### Source types (in order of preference)

| Source format | Example | When to use |
|---|---|---|
| **skills.sh URL** | `https://skills.sh/google-labs-code/stitch-skills/design-md` | When a user gives you a `skills.sh` link. This is the managed skill registry — **always prefer it when available**. |
| **Key-style string** | `google-labs-code/stitch-skills/design-md` | Shorthand for the same skill — `org/repo/skill-name` format. Equivalent to the skills.sh URL. |
| **GitHub URL** | `https://github.com/vercel-labs/agent-browser` | When the skill is in a GitHub repo but not on skills.sh. |
| **Local path** | `/abs/path/to/skill-dir` | When the skill is on disk (dev/testing only). |

**Critical:** If a user gives you a `https://skills.sh/...` URL, use that URL or its key-style equivalent (`org/repo/skill-name`) as the `source`. Do **not** convert it to a GitHub URL — skills.sh is the managed registry and the source of truth for versioning, discovery, and updates.

### Example: skills.sh import (preferred)

```sh
curl -sS -X POST "$OUTPOST_API_URL/api/spaces/$OUTPOST_SPACE_ID/skills/import" \
  -H "Authorization: Bearer $OUTPOST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "https://skills.sh/google-labs-code/stitch-skills/design-md"
  }'
```

Or equivalently using the key-style string:

```sh
curl -sS -X POST "$OUTPOST_API_URL/api/spaces/$OUTPOST_SPACE_ID/skills/import" \
  -H "Authorization: Bearer $OUTPOST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "google-labs-code/stitch-skills/design-md"
  }'
```

### Example: GitHub import

```sh
curl -sS -X POST "$OUTPOST_API_URL/api/spaces/$OUTPOST_SPACE_ID/skills/import" \
  -H "Authorization: Bearer $OUTPOST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "https://github.com/vercel-labs/agent-browser"
  }'
```

You can also use source strings such as:

- `google-labs-code/stitch-skills/design-md`
- `vercel-labs/agent-browser/agent-browser`
- `npx skills add https://github.com/vercel-labs/agent-browser --skill agent-browser`

If the task is to discover skills from the space project workspaces first:

```sh
curl -sS -X POST "$OUTPOST_API_URL/api/spaces/$OUTPOST_SPACE_ID/skills/scan-projects" \
  -H "Authorization: Bearer $OUTPOST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Inspect What Was Installed

```sh
curl -sS "$OUTPOST_API_URL/api/spaces/$OUTPOST_SPACE_ID/skills" \
  -H "Authorization: Bearer $OUTPOST_API_KEY"
```

Read the skill entry and its `SKILL.md`:

```sh
curl -sS "$OUTPOST_API_URL/api/spaces/$OUTPOST_SPACE_ID/skills/<skill-id>" \
  -H "Authorization: Bearer $OUTPOST_API_KEY"

curl -sS "$OUTPOST_API_URL/api/spaces/$OUTPOST_SPACE_ID/skills/<skill-id>/files?path=SKILL.md" \
  -H "Authorization: Bearer $OUTPOST_API_KEY"
```

## Assign Skills To An Existing Agent

`desiredSkills` accepts:

- exact space skill key
- exact space skill id
- exact slug when it is unique in the space

The server persists canonical space skill keys.

```sh
curl -sS -X POST "$OUTPOST_API_URL/api/agents/<agent-id>/skills/sync" \
  -H "Authorization: Bearer $OUTPOST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "desiredSkills": [
      "vercel-labs/agent-browser/agent-browser"
    ]
  }'
```

If you need the current state first:

```sh
curl -sS "$OUTPOST_API_URL/api/agents/<agent-id>/skills" \
  -H "Authorization: Bearer $OUTPOST_API_KEY"
```

## Include Skills During Hire Or Create

Use the same space skill keys or references in `desiredSkills` when hiring or creating an agent:

```sh
curl -sS -X POST "$OUTPOST_API_URL/api/spaces/$OUTPOST_SPACE_ID/agent-hires" \
  -H "Authorization: Bearer $OUTPOST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "QA Browser Agent",
    "role": "qa",
    "adapterType": "codex_local",
    "adapterConfig": {
      "cwd": "/abs/path/to/repo"
    },
    "desiredSkills": [
      "agent-browser"
    ]
  }'
```

For direct create without approval:

```sh
curl -sS -X POST "$OUTPOST_API_URL/api/spaces/$OUTPOST_SPACE_ID/agents" \
  -H "Authorization: Bearer $OUTPOST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "QA Browser Agent",
    "role": "qa",
    "adapterType": "codex_local",
    "adapterConfig": {
      "cwd": "/abs/path/to/repo"
    },
    "desiredSkills": [
      "agent-browser"
    ]
  }'
```

## Notes

- Built-in Outpost runtime skills are still added automatically when required by the adapter.
- If a reference is missing or ambiguous, the API returns `422`.
- Prefer linking back to the relevant issue, approval, and agent when you comment about skill changes.
- Use space portability routes when you need whole-package import/export, not just a skill:
  - `POST /api/spaces/:spaceId/imports/preview`
  - `POST /api/spaces/:spaceId/imports/apply`
  - `POST /api/spaces/:spaceId/exports/preview`
  - `POST /api/spaces/:spaceId/exports`
- Use skill-only import when the task is specifically to add a skill to the space library without importing the surrounding space/team/package structure.
