---
title: Importing & Exporting Spaces
summary: Export spaces to portable packages and import them from local paths or GitHub
---

Outpost spaces can be exported to portable markdown packages and imported from local directories or GitHub repositories. This lets you share space configurations, duplicate setups, and version-control your agent teams.

## Package Format

Exported packages follow the [Agent Spaces specification](/spaces/spaces-spec) and use a markdown-first structure:

```text
my-space/
├── COMPANY.md          # Space metadata
├── agents/
│   ├── ceo/AGENT.md    # Agent instructions + frontmatter
│   └── cto/AGENT.md
├── projects/
│   └── main/PROJECT.md
├── skills/
│   └── review/SKILL.md
├── tasks/
│   └── onboarding/TASK.md
└── .outpost.yaml     # Adapter config, env inputs, routines
```

- **COMPANY.md** defines space name, description, and metadata.
- **AGENT.md** files contain agent identity, role, and instructions.
- **SKILL.md** files are compatible with the Agent Skills ecosystem.
- **.outpost.yaml** holds Outpost-specific config (adapter types, env inputs, budgets) as an optional sidecar.

## Export & Import in the App

Both flows are also available in the web UI as space settings pages: **Export** and **Import** appear in the space settings navigation.

> **Cloud-managed instances:** when a hosting platform manages the instance, the space is provisioned by the platform and importing is disabled — the Import page and buttons are hidden, and every import API route answers `403` with `code: "cloud_managed"`. Export stays available, so you can always take your space's data with you. Self-hosted instances keep the full import surface.

The **Export** page lets you pick exactly which files go into the bundle before downloading it. Above the file tree it shows a **"Not included in this export"** panel — the export fidelity report — listing data the bundle will not carry (for example attachments, approvals, cost history, or activity log entries), with blocking issues highlighted.

The **Import** page previews the package, lets you resolve name collisions and adapter assignments, and applies the import. A **"Start imported agents and routines paused"** checkbox (on by default) makes imported agents and routines land paused instead of live. After the import finishes, an **"Activate imported agents and routines"** panel lists everything that was imported paused so you can resume the agents and activate the routines you select — nothing starts running until you say so.

## Exporting a Space

Export a space into a portable folder:

```sh
outpost space export <space-id> --out ./my-export
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--out <path>` | Output directory (required) | — |
| `--include <values>` | Comma-separated set: `space`, `agents`, `projects`, `issues`, `tasks`, `skills` | `space,agents` |
| `--skills <values>` | Export only specific skill slugs | all |
| `--projects <values>` | Export only specific project shortnames or IDs | all |
| `--issues <values>` | Export specific issue identifiers or IDs | none |
| `--project-issues <values>` | Export issues belonging to specific projects | none |
| `--expand-referenced-skills` | Vendor skill file contents instead of keeping upstream references | `false` |

### Examples

```sh
# Export space with agents and projects
outpost space export abc123 --out ./backup --include space,agents,projects

# Export everything including tasks and skills
outpost space export abc123 --out ./full-export --include space,agents,projects,tasks,skills

# Export only specific skills
outpost space export abc123 --out ./skills-only --include skills --skills review,deploy
```

### What Gets Exported

- Space name, description, and metadata
- Agent names, roles, reporting structure, and instructions
- Project definitions and workspace config
- Task/issue descriptions (when included)
- Skill packages (as references or vendored content)
- Adapter type and env input declarations in `.outpost.yaml`

Secret values, machine-local paths, and database IDs are **never** exported.

## Importing a Space

Import from a local directory, GitHub URL, or GitHub shorthand:

```sh
# From a local folder
outpost space import ./my-export

# From a GitHub URL
outpost space import https://github.com/org/repo

# From a GitHub subfolder
outpost space import https://github.com/org/repo/tree/main/spaces/acme

# From GitHub shorthand
outpost space import org/repo
outpost space import org/repo/spaces/acme
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--target <mode>` | `new` (create a new space) or `existing` (merge into existing) | inferred from context |
| `--space-id <id>` | Target space ID for `--target existing` | current context |
| `--new-space-name <name>` | Override space name for `--target new` | from package |
| `--include <values>` | Comma-separated set: `space`, `agents`, `projects`, `issues`, `tasks`, `skills` | auto-detected |
| `--agents <list>` | Comma-separated agent slugs to import, or `all` | `all` |
| `--collision <mode>` | How to handle name conflicts: `rename`, `skip`, or `replace` | `rename` |
| `--ref <value>` | Git ref for GitHub imports (branch, tag, or commit) | default branch |
| `--dry-run` | Preview what would be imported without applying | `false` |
| `--yes` | Skip the interactive confirmation prompt | `false` |
| `--json` | Output result as JSON | `false` |

### Target Modes

- **`new`** — Creates a fresh space from the package. Good for duplicating a space template.
- **`existing`** — Merges the package into an existing space. Use `--space-id` to specify the target.

If `--target` is not specified, Outpost infers it: if a `--space-id` is provided (or one exists in context), it defaults to `existing`; otherwise `new`.

### Collision Strategies

When importing into an existing space, agent or project names may conflict with existing ones:

- **`rename`** (default) — Appends a suffix to avoid conflicts (e.g., `ceo` becomes `ceo-2`).
- **`skip`** — Skips entities that already exist.
- **`replace`** — Overwrites existing entities. Only available for non-safe imports (not available through the CEO API).

### Interactive Selection

When running interactively (no `--yes` or `--json` flags), the import command shows a selection picker before applying. You can choose exactly which agents, projects, skills, and tasks to import using a checkbox interface.

### Preview Before Applying

Always preview first with `--dry-run`:

```sh
outpost space import org/repo --target existing --space-id abc123 --dry-run
```

The preview shows:
- **Package contents** — How many agents, projects, tasks, and skills are in the source
- **Import plan** — What will be created, renamed, skipped, or replaced
- **Env inputs** — Environment variables that may need values after import
- **Warnings** — Potential issues like missing skills or unresolved references

Imported agents always land with timer heartbeats disabled. Assignment/on-demand wake behavior from the package is preserved, but scheduled runs stay off until a board operator re-enables them.

Imports can additionally request `pauseAutomations` (the default in the app's Import page) so imported agents and routines land fully paused. Use the post-import activation panel — or resume the agents and activate the routines individually — when you are ready for them to run.

### Common Workflows

**Clone a space template from GitHub:**

```sh
outpost space import org/space-templates/engineering-team \
  --target new \
  --new-space-name "My Engineering Team"
```

**Add agents from a package into your existing space:**

```sh
outpost space import ./shared-agents \
  --target existing \
  --space-id abc123 \
  --include agents \
  --collision rename
```

**Import a specific branch or tag:**

```sh
outpost space import org/repo --ref v2.0.0 --dry-run
```

**Non-interactive import (CI/scripts):**

```sh
outpost space import ./package \
  --target new \
  --yes \
  --json
```

## API Endpoints

The CLI commands use these API endpoints under the hood:

| Action | Endpoint |
|--------|----------|
| Export space | `POST /api/spaces/{spaceId}/export` |
| Export fidelity report | `GET /api/spaces/{spaceId}/export/fidelity` |
| Preview import (existing space) | `POST /api/spaces/{spaceId}/imports/preview` |
| Apply import (existing space) | `POST /api/spaces/{spaceId}/imports/apply` |
| Preview import (new space) | `POST /api/spaces/import/preview` |
| Apply import (new space) | `POST /api/spaces/import` |

Import apply requests accept `pauseAutomations: true` to create imported agents and routines in a paused state.

CEO agents can also use the safe import routes (`/imports/preview` and `/imports/apply`) which enforce non-destructive rules: `replace` is rejected, collisions resolve with `rename` or `skip`, and issues are always created as new.

## GitHub Sources

Outpost supports several GitHub URL formats:

- Full URL: `https://github.com/org/repo`
- Subfolder URL: `https://github.com/org/repo/tree/main/path/to/space`
- Shorthand: `org/repo`
- Shorthand with path: `org/repo/path/to/space`

Use `--ref` to pin to a specific branch, tag, or commit hash when importing from GitHub.
