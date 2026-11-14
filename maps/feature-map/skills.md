---
navigation: {"section":"Agents and reusable capabilities","sectionOrder":30,"order":30}
---

# Skills and Skill Studio

Feature ID: `skills`.

Outpost no longer exposes a user-facing Skill Store, Skill Studio, or public
catalog. Codex and Claude manage their native skills outside this UI.

The backend retains only the runtime contracts needed to import an explicitly
chosen local or remote skill, attach it to an agent, pin the version used by a
run, and restore that version during recovery. Historical database rows remain
readable until the schema is deliberately compacted.

## Sub-features

- `discovery`: `skills/discovery` — import an explicitly selected source into a Space.
- `authoring`: `skills/authoring` — retained API compatibility for managed skill content.
- `versions`: `skills/versions` — immutable version selection and recovery.
- `policy`: `skills/policy` — agent attachment and runtime authorization.
- `testing`: `skills/testing` — retained bounded runtime test API.

Agent access and retained API details: [companion map](../agent-access-map/skills.md).

## Retained verification

- [agent skill routes](../../server/src/__tests__/agent-skills-routes.test.ts)
- [runtime selection](../../server/src/__tests__/space-skills-runtime-selection.test.ts)
- [version cache](../../server/src/__tests__/skill-version-cache.test.ts)
- [runtime concurrency](../../server/src/__tests__/space-skills-runtime-concurrency.test.ts)

These checks cover execution support, not a discoverable marketplace or an
authoring product surface.
