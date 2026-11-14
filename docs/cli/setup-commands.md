---
title: Setup Commands
summary: Onboard, run, doctor, and configure
---

Instance setup and diagnostics commands.

## `outpost run`

One-command bootstrap and start:

```sh
pnpm outpost run
```

Does:

1. Auto-onboards if config is missing
2. Runs `outpost doctor` with repair enabled
3. Starts the server when checks pass

Choose a specific instance:

```sh
npx @outpost/cli run --instance dev
```

## `outpost onboard`

Interactive first-time setup:

```sh
pnpm outpost onboard
```

If Outpost is already configured, rerunning `onboard` keeps the existing config in place. Use `outpost configure` to change settings on an existing install.

First prompt:

1. `Quickstart` (recommended): local defaults (embedded database, no LLM provider, local disk storage, default secrets)
2. `Advanced setup`: full interactive configuration

Start immediately after onboarding:

```sh
pnpm outpost onboard --run
```

Quickstart defaults + immediate start:

```sh
pnpm outpost onboard --yes
```

When onboarding starts Outpost from an interactive terminal, it opens the
onboarding page in your browser once. Non-interactive terminals stay silent.
Suppress browser opening explicitly for headless or automated runs with either
environment variable:

```sh
OUTPOST_NO_BROWSER=1 pnpm outpost onboard --yes
OUTPOST_OPEN_ON_LISTEN=false pnpm outpost onboard --yes
```

On an existing install, `--yes` now preserves the current config and just starts Outpost with that setup.

## `outpost doctor`

Health checks with optional auto-repair:

```sh
pnpm outpost doctor
pnpm outpost doctor --repair
```

Validates:

- Server configuration
- Database connectivity
- Secrets adapter configuration, including AWS Secrets Manager non-secret env
  config when selected
- Storage configuration
- Missing key files

## `outpost configure`

Update configuration sections:

```sh
pnpm outpost configure --section server
pnpm outpost configure --section secrets
pnpm outpost configure --section storage
```

`--section secrets` updates the deployment-level provider used as the fallback
for secrets that do not target a specific space vault. Per-space provider
vaults (named instances, default vault selection, multiple vaults per provider,
coming-soon GCP/Vault) live in the board UI under
`Space Settings → Secrets → Provider vaults` and the
`/api/spaces/{spaceId}/secret-provider-configs` API.

## `outpost env`

Show resolved environment configuration:

```sh
pnpm outpost env
```

This now includes bind-oriented deployment settings such as `OUTPOST_BIND` and `OUTPOST_BIND_HOST` when configured.

## `outpost allowed-hostname`

Allow a private hostname for authenticated/private mode:

```sh
npx @outpost/cli allowed-hostname my-tailscale-host
```

## Local Storage Paths

| Data | Default Path |
|------|-------------|
| Config | `~/.outpost/instances/default/config.json` |
| Database | `~/.outpost/instances/default/db` |
| Logs | `~/.outpost/instances/default/logs` |
| Storage | `~/.outpost/instances/default/data/storage` |
| Secrets key | `~/.outpost/instances/default/secrets/master.key` |

Override with:

```sh
OUTPOST_HOME=/custom/home OUTPOST_INSTANCE_ID=dev pnpm outpost run
```

Or pass `--data-dir` directly on any command:

```sh
npx @outpost/cli run --data-dir ./tmp/outpost-dev
npx @outpost/cli doctor --data-dir ./tmp/outpost-dev
```
