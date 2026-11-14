---
title: CLI Overview
summary: CLI installation and setup
---

The Outpost CLI handles instance setup, diagnostics, and control-plane operations.

## Usage

```sh
pnpm outpost --help
```

## Global Options

All commands support:

| Flag | Description |
|------|-------------|
| `--data-dir <path>` | Local Outpost data root (isolates from `~/.outpost`) |
| `--api-base <url>` | API base URL |
| `--api-key <token>` | API authentication token |
| `--context <path>` | Context file path |
| `--profile <name>` | Context profile name |
| `--json` | Output as JSON |

Space-scoped commands also accept `--space-id <id>`.

For clean local instances, pass `--data-dir` on the command you run:

```sh
npx @outpost/cli run --data-dir ./tmp/outpost-dev
```

## Context Profiles

Store defaults to avoid repeating flags:

```sh
# Set defaults
npx @outpost/cli context set --api-base http://localhost:3100 --space-id <id>

# View current context
pnpm outpost context show

# List profiles
pnpm outpost context list

# Switch profile
npx @outpost/cli context use default
```

To avoid storing secrets in context, use an env var:

```sh
npx @outpost/cli context set --api-key-env-var-name OUTPOST_API_KEY
export OUTPOST_API_KEY=...
```

Secret operations are available under `outpost secrets`:

```sh
npx @outpost/cli secrets declarations --space-id <space-id> --kind secret
npx @outpost/cli secrets create --space-id <space-id> --name anthropic-api-key --value-env ANTHROPIC_API_KEY
npx @outpost/cli secrets link --space-id <space-id> --name prod-stripe-key --provider aws_secrets_manager --external-ref <provider-ref>
npx @outpost/cli secrets doctor --space-id <space-id>
npx @outpost/cli secrets migrate-inline-env --space-id <space-id> --apply
```

Context is stored at `~/.outpost/context.json`.

## Command Categories

The CLI has two categories:

1. **[Setup commands](/cli/setup-commands)** — instance bootstrap, diagnostics, configuration
2. **[Control-plane commands](/cli/control-plane-commands)** — issues, agents, approvals, activity
