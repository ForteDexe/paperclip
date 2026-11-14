# Space skills

Outpost keeps a per-space library of skills that can be attached to agents.
There is no public or app-shipped skill marketplace. Skills come from sources
the operator explicitly controls.

## Supported sources

- A local directory containing `SKILL.md`
- A GitHub repository path
- A `skills.sh` reference
- A direct URL
- A managed skill created in Outpost

Importing a skill adds it to the space library. Attaching it to an agent is a
separate operation; this keeps library changes from silently changing running
agents.

## CLI workflow

```sh
npx @outpost/cli skills list --space-id <space-id>
npx @outpost/cli skills import ./skills/my-skill --space-id <space-id>
npx @outpost/cli skills show <skill-id-or-key-or-slug> --space-id <space-id>
npx @outpost/cli skills agent sync <agent-id> --skill <skill-id-or-key-or-slug> --mode add --space-id <space-id>
```

Use `skills create` for a managed skill and `skills scan-projects` to discover
skills in known project workspaces. `skills check`, `skills update`, and
`skills audit` maintain imported sources. Required Outpost runtime instructions
remain server-managed and are added independently of optional assignments.

## Runtime behavior

The server resolves the desired skill set at run preparation, records immutable
versions, and materializes the selected files into the agent runtime. Recovery
uses the saved selection so a retry does not silently switch skill versions.

Local skills remain editable at their source. GitHub, URL, and `skills.sh`
imports preserve source metadata so Outpost can check for updates without a
central marketplace.
