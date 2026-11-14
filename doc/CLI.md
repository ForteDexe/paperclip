# CLI Reference

Outpost CLI now supports both:

- installation and lifecycle management (`install`, `uninstall`, `update`, `upgrade`, `service`)
- instance setup/diagnostics (`onboard`, `doctor`, `configure`, `env`, `allowed-hostname`, `env-lab`)
- control-plane client operations (issues, approvals, agents, activity, dashboard)

## Browser-approved Board authentication

`npx @outpost/cli auth login --api-base <instance-url>` creates a ten-minute
challenge and prints a browser approval link. The link uses the instance's
canonical public origin when configured, so reverse proxies do not send the
browser to an internal upstream hostname. Sign in to the instance, review
the requesting command and full Board access, then approve. The pending token
cannot authenticate before approval. The CLI verifies its resulting identity
before storing its credential in its private auth store. The default Board key
expires after thirty days; `npx @outpost/cli auth logout` attempts server-side revocation and removes the
local credential; check its `revoked` result.

A requested space supplies audit context, not a restriction on the key's
access. Approval requires current access to that space (active membership or
instance-admin authority). A different person cannot take over an approved
challenge. Cancellation and approval serialize on the same challenge; cancelling
an already approved challenge does not revoke its key.

The instance limits challenge creation to twenty requests per minute per client
IP, and polling to 120, using separate process-local budgets. The normal
one-second poll interval remains supported. HTTP 429 includes `Retry-After`.
Operators behind a proxy must configure `TRUST_PROXY` for their actual trusted
proxy boundary; client-supplied forwarding headers alone never mint a budget.
These limits are per instance process, not a distributed denial-of-service or
historical-record retention guarantee.

The browser approval page retries only rate-limited challenge reads, up to
three times. It honors the server delay, or waits sixty seconds when no valid
delay is provided. Scheduling stops at ten minutes or a known earlier
challenge expiry. Browser suspension can delay a queued read. The server still
enforces the original expiry. Approval is never resubmitted automatically.

Cloud front doors must preserve only anonymous challenge creation and
capability-bound status polling. Approval uses the normal signed-in browser;
no Cloud user identity is synthesized for the CLI's unauthenticated requests.

## Security: safe invocation for content-bearing arguments

Use `npx @outpost/cli` for any command whose argument can hold untrusted or
semi-trusted content. Untrusted content includes issue text, comment bodies,
Markdown, pasted snippets, and model output. `npx` runs the CLI binary directly.
It passes the argument as an inert `argv` value. It does not run a shell over the
value. `npx @outpost/cli` works on any machine with Node: it runs a local install
of the `@outpost/cli` package, and it fetches the published package when no local
install is present.

Do not use `pnpm outpost` for a content-bearing argument. `pnpm outpost`
is a `package.json` script. `pnpm` builds a `/bin/sh` command string and appends
the argument to it, so the shell reads the argument first. The shell interprets
these spans before the CLI starts:

- command substitution: a backtick pair or `$( )`
- variable expansion: `$NAME` or `${NAME}` (this can leak a secret value into the persisted argument)

A crafted value can run an arbitrary command as the invoking user. A crafted
value can also expand an environment variable into the stored argument. No
CLI-side check stops this, because the shell runs before `cli/src` starts. This
is true even when the argument comes from a quoted shell variable, because `pnpm`
re-evaluates the value in its own shell.

Safe forms:

- `npx @outpost/cli <command> <args>` — the documented default. It passes an inert
  `argv` value and runs on any machine.
- `node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts <command> <args>` —
  the safe form to run the local source from a monorepo checkout. It is the exact
  command that the `pnpm outpost` script wraps, but it runs directly, so no
  shell reads the argument. Use it when you must test your local `cli/src`
  changes with a content-bearing argument.

Unsafe or broken forms:

- `pnpm outpost <command> <args>` — unsafe. `pnpm` runs the argument through a
  shell first.
- `pnpm run <script> -- <args>`, or any `package.json` script that wraps the CLI —
  unsafe for the same reason.
- `pnpm exec outpost <command> <args>` — broken. The root workspace does not
  depend on the `@outpost/cli` package, so `pnpm` does not link its binary into
  `node_modules/.bin`. The command fails with `Command "outpost" not found`,
  even after a build. Do not use it.

Static placeholders only: a document must show a static placeholder such as
`<host>` in a command example, never a live `$( )` or `$NAME` span. The reader's
own shell expands such a span on paste, before any CLI or `npx` receives argv, so
a direct-exec form does not stop it.

`pnpm outpost` stays acceptable only for a fully literal local lifecycle or
setup command. A fully literal command carries no substitutable value. It has no
placeholder, no example value the reader replaces, no interpolation, no path, no
ref, no id, and no name. It holds the subcommand and, at most, flags that take no
value.

The allowlist of literal commands lives in one place:
`server/src/__tests__/cli-invocation-safety.test.ts`. A guard test enforces it
fail-closed. Any `pnpm outpost` line whose command string is not an exact
allowlist entry is an offender. The allowlist holds commands such as `run`,
`onboard`, `onboard --yes`, `doctor`, `configure --section <name>`, `connect`,
`env-lab up`, `env-lab down`, `context show`, `context list`,
`worktree ensure-seeded`, and `worktree env`.

Every invocation that carries a positional value or an option value uses
`npx @outpost/cli` instead. This covers a hostname (`allowed-hostname`), an import
URL or folder (`space import`), an identifier or secret (`--space-id`,
`--agent-id`, `--claim-secret`), a payload (`--payload-json`), free text
(`--body`, `--title`, `--comment`), a data directory (`--data-dir`), an instance
(`--instance`), a bind preset (`--bind`), a context-profile name, and every
worktree path, ref, id, or name option. A runtime value counts as non-fixed even
when it looks safe. The private-hostname guard builds `allowed-hostname <value>`
from the request Host header, so it uses `npx @outpost/cli`.

For a command that must run the local checked-out source with a value, use the
direct-exec form: `node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts
<command> <args>`.

The `pnpm --filter @outpost/*` build and test commands are not CLI
invocation. They do not change.

### Offline and air-gapped use

`npx @outpost/cli` runs offline when the `@outpost/cli` package is already in a
local install or in the npm cache. It reaches the network only when the package
is in neither place.

To force cache-only resolution and block any network attempt, run
`npx --offline @outpost/cli <command> <args>`. Use `npx --prefer-offline
@outpost/cli` when you accept a fetch only for a missing package.

To prepare an air-gapped host, install the package one time while the host is
online. Run `npm install -g @outpost/cli`, or run the documented `install.sh`
path. After that step, both `npx @outpost/cli` and the installed `outpost`
binary run offline. Both pass an inert `argv` value.

To move the package without a registry, run `npm pack @outpost/cli` on an online
host. Copy the tarball to the air-gapped host. Run `npm install -g
./outpost-cli-<version>.tgz`.

Do not use `pnpm outpost` as an offline fallback for a content-bearing
argument. It runs the argument through a shell first, offline or online. It also
resolves only inside a monorepo checkout.

A monorepo contributor who works offline uses the direct-exec form that this
section documents above: `node cli/node_modules/tsx/dist/cli.mjs
cli/src/index.ts <command> <args>`. It passes an inert `argv` value and runs the
local source.

## Base Usage

Use repo script in development:

```sh
pnpm outpost --help
```

Recommended installation and interactive onboarding:

```sh
curl -fsSLO https://outpost.ing/install.sh
curl -fsSLO https://outpost.ing/install.sh.sha256
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum -c install.sh.sha256
else
  shasum -a 256 -c install.sh.sha256
fi
bash install.sh
```

The checksum detects transfer or publishing mistakes but is served from the
same origin as the installer. Use a release-tag or commit-pinned GitHub copy
when you need an independently hosted source. Piped installs require supported
Node.js, npm, and npx to already be installed; download the script first before
allowing it to bootstrap Node.js with privileged package-manager commands.

First-time local bootstrap from a source checkout:

```sh
pnpm outpost run
```

Choose local instance:

```sh
npx @outpost/cli run --instance dev
```

## Isolated Manual Test Drives

`outpost test-drive` creates or reuses an isolated local data directory,
ensures one usable CEO agent exists in a fresh database, starts Outpost in the
foreground, and opens the browser after initialization succeeds. It never
installs a background service and never creates a goal, project, issue, task,
or heartbeat.

```sh
npx @outpost/cli test-drive \
  [-d, --data-dir <path>] \
  [--space-name <name>] \
  [--agent-name <name>] \
  [--harness <claude|codex|opencode>] \
  [--model <model-id>] \
  [--api-key-env <variable> | --api-key <value>] \
  [--no-browser]
```

Defaults are `Test Space`, a `CEO` agent with the `ceo` role, and the Claude
harness. Without `--data-dir`, every invocation creates a unique OS temporary
directory and prints its absolute path. The directory is retained after exit
for inspection. An explicit data directory is reused and is never reset. The
reused directory must use Outpost's embedded database; `DATABASE_URL`,
`DATABASE_MIGRATION_URL`, and configs with `database.mode: postgres` are
rejected so test-drive cannot mutate an external database. The server also
ignores the invocation directory's `.env` for test-drive launches, while still
loading the selected instance's own environment file. Reused directories also
retain the normal guard against colliding with a managed Outpost service. The
server uses the first available loopback port at or above `3100`, so an
unrelated local Outpost process can remain running.

Harness configuration:

| Harness | Agent adapter | Agent credential variable | Model |
| --- | --- | --- | --- |
| `claude` | `claude_local` | `ANTHROPIC_API_KEY` | Optional; omitted uses the adapter default |
| `codex` | `codex_local` | `OPENAI_API_KEY` | Optional; omitted uses the adapter default |
| `opencode` | `opencode_local` | `OPENROUTER_API_KEY` | Required and must begin with `openrouter/` |

OpenCode model references retain their complete path, including additional
slashes:

```sh
OPENROUTER_API_KEY=... npx @outpost/cli test-drive \
  --harness opencode \
  --model openrouter/anthropic/claude-sonnet-4.5
```

Credentials come from `--api-key`, the variable named by `--api-key-env`, or
the harness's canonical environment variable shown in the table. `--api-key`
and `--api-key-env` are mutually exclusive. A custom source variable is still
stored and projected under the canonical target variable:

```sh
MY_ROUTER_KEY=... npx @outpost/cli test-drive \
  --harness opencode \
  --model openrouter/openai/gpt-5.4 \
  --api-key-env MY_ROUTER_KEY
```

Credentials are stored through Outpost's user-secret reference path and are
redacted from Outpost command output. Outpost does not print `--api-key`,
and it removes the value from its JavaScript argument view immediately after
Commander parses it. Outpost does not put the raw argument list in telemetry,
API metadata, or diagnostics. Command wrappers, operating-system process
listings, and shell history can still expose values passed in arguments. This
is an explicit tradeoff for the local test-drive workflow. Prefer an exported
canonical variable or `--api-key-env` when that matters. Provider connectivity,
local harness installation, credential validity, and model availability are
intentionally checked only when the agent first runs.

When invoked inside a linked Git worktree, the command ignores inherited
`OUTPOST_IN_WORKTREE` state, launches in worktree mode, and verifies **Run
tasks in this worktree** is armed for the current instance before opening the
browser. In a primary checkout or non-Git directory it launches without
worktree mode and does not alter the setting. On reuse, if any space already
exists, all bootstrap flags are ignored and spaces, agents, and secrets are
left untouched; worktree-setting reconciliation is the only permitted
mutation.

Use `--no-browser` for a foreground instance that prints its ready URL without
opening it.

## Install, Update, And Uninstall

Managed installs keep CLI payloads under `~/.outpost/cli`, expose a stable
`~/.local/bin/outpost` shim, switch versions atomically, and retain two
previous payloads for rollback.

```sh
outpost install
outpost install --canary
outpost install --version <version>
outpost install --ref <branch|tag|sha> [--repo owner/repo]
outpost update
outpost update --latest|--canary|--version <version>
outpost update --rollback
outpost upgrade
outpost uninstall
```

`upgrade` aliases `update`. `uninstall` removes managed code and the shim but
preserves instance data under `~/.outpost/instances/`. See
`doc/INSTALLING.md` for installation methods, security notes, PATH setup, and
the complete update and rollback behavior.

## Onboarding And Service Management

Interactive onboarding offers to install a background service on supported
platforms. `--yes` never installs it implicitly; automation must opt in.

```sh
outpost onboard
outpost onboard --yes
outpost onboard --yes --install-service
outpost onboard --yes --no-install-service
```

Service lifecycle commands remain under the `service` namespace:

```sh
outpost service install [--no-start-now] [--no-start-on-login]
outpost service uninstall
outpost service start
outpost service stop
outpost service restart [--wait]
outpost service status [--json]
outpost service logs [-f]
```

Every service verb supports `--instance <id>` and `--json`. Linux and WSL2 use
a systemd user unit when available; macOS uses a LaunchAgent. Unsupported
environments receive foreground `outpost run` guidance.

`outpost doctor` includes managed-install and service-health diagnostics in
addition to configuration, storage, database, logging, and port checks.

## Deployment Modes

Mode taxonomy and design intent are documented in `doc/DEPLOYMENT-MODES.md`.

Current CLI behavior:

- `outpost onboard` and `outpost configure --section server` set deployment mode in config
- server onboarding/configure ask for reachability intent and write `server.bind`
- `outpost run --bind <loopback|lan|tailnet>` passes a quickstart bind preset into first-run onboarding when config is missing
- runtime can override mode with `OUTPOST_DEPLOYMENT_MODE`
- `outpost run` and `outpost doctor` still do not expose a direct low-level `--mode` flag

Canonical behavior is documented in `doc/DEPLOYMENT-MODES.md`.

Allow an authenticated/private hostname (for example custom Tailscale DNS):

```sh
npx @outpost/cli allowed-hostname dotta-macbook-pro
```

Bring up the default local SSH fixture for environment testing:

```sh
pnpm outpost env-lab up
pnpm outpost env-lab doctor
pnpm outpost env-lab status --json
pnpm outpost env-lab down
```

All client commands support:

- `--data-dir <path>`
- `--api-base <url>`
- `--api-key <token>`
- `--context <path>`
- `--profile <name>`
- `--json`

Space-scoped commands also support `--space-id <id>`.

API base resolution order:

1. `--api-base <url>`
2. `OUTPOST_API_URL`
3. selected context profile `apiBase`
4. local Outpost config server port
5. `http://localhost:3100`

Connection failures include the attempted URL and a `GET /api/health` check hint.

## Connect Wizard

```sh
pnpm outpost connect
```

`connect` confirms the resolved API base, verifies `GET /api/health`, authenticates board access when needed, and saves a persona-aware profile:

- `persona=board` for board operator profiles
- `persona=agent` with `agentId` and `agentName` for agent profiles

Profiles store token env-var names, not plaintext tokens. The wizard prints shell exports for the newly created token.

Use `--data-dir` on any CLI command to isolate all default local state (config/context/db/logs/storage/secrets) away from `~/.outpost`:

```sh
npx @outpost/cli run --data-dir ./tmp/outpost-dev
npx @outpost/cli issue list --data-dir ./tmp/outpost-dev
```

## Context Profiles

Store local defaults in `~/.outpost/context.json`:

```sh
npx @outpost/cli context set --api-base http://localhost:3100 --space-id <space-id>
npx @outpost/cli context set --persona agent --agent-id <agent-id> --api-key-env-var-name OUTPOST_API_KEY
pnpm outpost context show
pnpm outpost context list
npx @outpost/cli context use default
```

To avoid storing secrets in context, set `apiKeyEnvVarName` and keep the key in env:

```sh
npx @outpost/cli context set --api-key-env-var-name OUTPOST_API_KEY
export OUTPOST_API_KEY=...
```

## Organization Commands

```sh
npx @outpost/cli space list
npx @outpost/cli space get <space-id>
npx @outpost/cli space current [--space-id <space-id>]
npx @outpost/cli space stats
npx @outpost/cli space create --payload-json '{...}'
npx @outpost/cli space update <space-id> --payload-json '{...}'
npx @outpost/cli space branding:update <space-id> --payload-json '{...}'
npx @outpost/cli space archive <space-id>
npx @outpost/cli space export <space-id> --out ./space --include space,agents,projects,issues,skills
npx @outpost/cli space export:preview <space-id> --payload-json '{...}'
npx @outpost/cli space export:api <space-id> --payload-json '{...}'
npx @outpost/cli space import ./space --target new --new-space-name "Imported Space"
npx @outpost/cli space import:preview <space-id> --payload-json '{...}'
npx @outpost/cli space import:apply <space-id> --payload-json '{...}'
npx @outpost/cli space delete <space-id-or-prefix> --yes --confirm <same-id-or-prefix>
```

Examples:

```sh
npx @outpost/cli space delete PAP --yes --confirm PAP
npx @outpost/cli space delete 5cbe79ee-acb3-4597-896e-7662742593cd --yes --confirm 5cbe79ee-acb3-4597-896e-7662742593cd
```

Notes:

- With agent authentication, `space list` and `space current` are
  agent-safe space selectors. `space list` first tries the board-wide list;
  if that is forbidden, it uses `--space-id`, `OUTPOST_SPACE_ID`, context,
  or `/api/agents/me` and then reads only that scoped space.
- `space create` requires board/instance-admin authentication because it is
  an instance-wide setup command.
- Deletion is server-gated by `OUTPOST_ENABLE_SPACE_DELETION`.
- With agent authentication, space deletion is space-scoped. Use the current space ID/prefix (for example via `--space-id` or `OUTPOST_SPACE_ID`), not another space.

## Issue Commands

```sh
npx @outpost/cli issue list --space-id <space-id> [--status todo,in_progress] [--assignee-agent-id <agent-id>] [--match text]
npx @outpost/cli issue get <issue-id-or-identifier>
npx @outpost/cli issue create --space-id <space-id> --title "..." [--description "..."] [--status todo] [--priority high] [--parent-id <issue-id> | --standalone]
npx @outpost/cli issue update <issue-id> [--status in_progress] [--comment "..."]
npx @outpost/cli issue delete <issue-id> --yes
npx @outpost/cli issue comment <issue-id> --body "..." [--attachment-id <id...>] [--reopen]
npx @outpost/cli issue comments <issue-id> [--limit 50]
npx @outpost/cli issue comment:get <issue-id> <comment-id>
npx @outpost/cli issue comment:delete <issue-id> <comment-id>
npx @outpost/cli issue runs <issue-id-or-identifier>
npx @outpost/cli issue live-runs <issue-id-or-identifier>
npx @outpost/cli issue active-run <issue-id-or-identifier>
npx @outpost/cli issue heartbeat-context <issue-id>
npx @outpost/cli issue checkout <issue-id> --agent-id <agent-id> [--expected-statuses todo,backlog,blocked]
npx @outpost/cli issue release <issue-id>
npx @outpost/cli issue force-release <issue-id>
```

`issue create` sent from an agent run bound to an ordinary execution task is parented under that task when `--parent-id` is omitted; pass `--standalone` to create intentionally top-level work (`parentId: null`). The two flags are mutually exclusive.

Issue subresources are exposed as Outpost API wrappers. Commands that map to broad server schemas accept JSON payloads and validate them with shared schemas before sending.

```sh
npx @outpost/cli issue child:create <issue-id> --payload-json '{"title":"Child task"}'
npx @outpost/cli issue approvals <issue-id>
npx @outpost/cli issue approval:link <issue-id> <approval-id>
npx @outpost/cli issue approval:unlink <issue-id> <approval-id>
npx @outpost/cli issue read <issue-id>
npx @outpost/cli issue unread <issue-id>
npx @outpost/cli issue archive <issue-id>
npx @outpost/cli issue unarchive <issue-id>
npx @outpost/cli issue recovery-actions <issue-id>
npx @outpost/cli issue recovery:resolve <issue-id> --outcome restored --source-issue-status todo
```

```sh
npx @outpost/cli issue documents <issue-id> [--include-system]
npx @outpost/cli issue document:get <issue-id> <key>
npx @outpost/cli issue document:put <issue-id> <key> --body-file ./plan.md [--title Plan]
npx @outpost/cli issue document:lock <issue-id> <key>
npx @outpost/cli issue document:unlock <issue-id> <key>
npx @outpost/cli issue document:revisions <issue-id> <key>
npx @outpost/cli issue document:restore <issue-id> <key> <revision-id>
npx @outpost/cli issue document:delete <issue-id> <key>
```

```sh
npx @outpost/cli issue work-products <issue-id>
npx @outpost/cli issue work-product:create <issue-id> --payload-json '{"type":"pull_request","provider":"github","title":"PR"}'
npx @outpost/cli issue work-product:update <work-product-id> --payload-json '{"status":"archived"}'
npx @outpost/cli issue work-product:delete <work-product-id>
npx @outpost/cli issue interactions <issue-id>
npx @outpost/cli issue interaction:create <issue-id> --payload-json '{"kind":"request_confirmation","payload":{"version":1,"prompt":"Continue?"}}'
npx @outpost/cli issue interaction:accept <issue-id> <interaction-id> [--selected-client-keys key1,key2]
npx @outpost/cli issue interaction:reject <issue-id> <interaction-id> [--reason "..."]
npx @outpost/cli issue interaction:respond <issue-id> <interaction-id> --answers-json '[{"questionId":"q1","optionIds":["yes"]}]'
npx @outpost/cli issue interaction:cancel <issue-id> <interaction-id> [--reason "..."]
```

```sh
npx @outpost/cli issue tree-state <issue-id>
npx @outpost/cli issue tree-preview <issue-id> --payload-json '{"mode":"pause"}'
npx @outpost/cli issue tree-holds <issue-id> [--status active] [--include-members]
npx @outpost/cli issue tree-hold:create <issue-id> --payload-json '{"mode":"pause","reason":"review"}'
npx @outpost/cli issue tree-hold:get <issue-id> <hold-id>
npx @outpost/cli issue tree-hold:release <issue-id> <hold-id> [--payload-json '{"reason":"done"}']
npx @outpost/cli issue attachments <issue-id>
npx @outpost/cli issue attachment:upload <issue-id> --space-id <space-id> --file ./artifact.txt
npx @outpost/cli issue attachment:download <attachment-id> [--out ./artifact.txt]
npx @outpost/cli issue attachment:delete <attachment-id>
npx @outpost/cli issue label:list --space-id <space-id>
npx @outpost/cli issue label:create --space-id <space-id> --name bug --color '#ff0000'
npx @outpost/cli issue label:delete <label-id>
npx @outpost/cli issue feedback:votes <issue-id>
npx @outpost/cli issue feedback:vote <issue-id> --payload-json '{"targetType":"issue_comment","targetId":"...","vote":"up"}'
```

## Project Commands

```sh
npx @outpost/cli project list --space-id <space-id>
npx @outpost/cli project get <project-id-or-shortname> [--space-id <space-id>]
npx @outpost/cli project create --space-id <space-id> --name "Launch Site" [--goal-ids <id1,id2>] [--lead-agent-id <id>]
npx @outpost/cli project update <project-id-or-shortname> [--status in_progress] [--space-id <space-id>]
npx @outpost/cli project delete <project-id-or-shortname> --yes [--space-id <space-id>]
```

Advanced project fields accept JSON:

```sh
npx @outpost/cli project create --space-id <space-id> --name "Ops" --env-json '{"OPENAI_API_KEY":{"kind":"secret","secretName":"openai-api-key"}}'
npx @outpost/cli project update <project-id> --execution-workspace-policy-json '{"enabled":true,"defaultMode":"shared_workspace"}'
```

## Goal Commands

```sh
npx @outpost/cli goal list --space-id <space-id>
npx @outpost/cli goal get <goal-id>
npx @outpost/cli goal create --space-id <space-id> --title "Grow revenue" [--level space] [--status active]
npx @outpost/cli goal update <goal-id> [--title "..."] [--status achieved]
npx @outpost/cli goal delete <goal-id> --yes
```

## Agent Commands

```sh
npx @outpost/cli agent list --space-id <space-id>
npx @outpost/cli agent get <agent-id>
npx @outpost/cli agent create --space-id <space-id> --payload-json '{"name":"Builder","adapterType":"codex_local"}'
npx @outpost/cli agent hire --space-id <space-id> --payload-json '{...}'
npx @outpost/cli agent update <agent-id> --payload-json '{"title":"Senior Builder"}'
npx @outpost/cli agent delete <agent-id> --yes
npx @outpost/cli agent me
npx @outpost/cli agent inbox
npx @outpost/cli agent inbox-mine --user-id <board-user-id>
npx @outpost/cli agent wake <agent-id-or-shortname> [--space-id <space-id>] [--reason "..."] [--payload '{"issueId":"..."}']
npx @outpost/cli agent pause <agent-id>
npx @outpost/cli agent resume <agent-id>
npx @outpost/cli agent approve <agent-id>
npx @outpost/cli agent terminate <agent-id>
npx @outpost/cli agent heartbeat:invoke <agent-id>
npx @outpost/cli agent claude-login <agent-id>
npx @outpost/cli agent local-cli <agent-id-or-shortname> --space-id <space-id>
```

Agent configuration and runtime endpoints:

```sh
npx @outpost/cli agent permissions:update <agent-id> --payload-json '{"canCreateAgents":true,"canCreateSkills":true,"canAssignTasks":true}'
npx @outpost/cli agent permission:grant <agent-id> commentary:view
npx @outpost/cli agent permission:revoke <agent-id> commentary:view
npx @outpost/cli agent configuration <agent-id>
npx @outpost/cli agent config-revisions <agent-id>
npx @outpost/cli agent config-revision:get <agent-id> <revision-id>
npx @outpost/cli agent config-revision:rollback <agent-id> <revision-id>
npx @outpost/cli agent runtime-state <agent-id>
npx @outpost/cli agent runtime-state:reset-session <agent-id> [--task-key <key>]
npx @outpost/cli agent task-sessions <agent-id>
npx @outpost/cli agent skills <agent-id>
npx @outpost/cli agent skills:sync <agent-id> --desired-skills outpost,github --mode add
npx @outpost/cli agent instructions-path:update <agent-id> --payload-json '{"path":"/path/to/AGENTS.md"}'
npx @outpost/cli agent instructions-bundle <agent-id>
npx @outpost/cli agent instructions-bundle:update <agent-id> --payload-json '{"mode":"managed"}'
npx @outpost/cli agent instructions-file:get <agent-id> --path AGENTS.md
npx @outpost/cli agent instructions-file:put <agent-id> --path AGENTS.md --content-file ./AGENTS.md
npx @outpost/cli agent instructions-file:delete <agent-id> --path AGENTS.md --yes
```

`permission:grant` and `permission:revoke` require a Board login with
`users:manage_permissions` in the agent's space. They change one permission
key and preserve all other grants. A grant applies without starting a new run.
Granting a key replaces that key's scope with an unscoped space grant;
revoking removes the key. Use `agent get <agent-id> --json` to inspect
`access.grants`. These commands do not reactivate an inactive membership.

Agent config, instructions, skills, project env, environment, secret, and workspace edits affect the next run. Active runs finish with the config they started with. When a saved session, reused workspace, or sandbox lease no longer matches the effective next-run config, Outpost may start fresh execution and records non-sensitive freshness categories in run result JSON and workspace operation logs.

`agent local-cli` is the quickest way to run local Claude/Codex manually as a Outpost agent:

- creates a new long-lived agent API key
- installs missing Outpost skills into `~/.codex/skills` and `~/.claude/skills`
- prints `export ...` lines for `OUTPOST_API_URL`, `OUTPOST_SPACE_ID`, `OUTPOST_AGENT_ID`, and `OUTPOST_API_KEY`

Example for shortname-based local setup:

```sh
npx @outpost/cli agent local-cli codexcoder --space-id <space-id>
npx @outpost/cli agent local-cli claudecoder --space-id <space-id>
```

## Token Commands

Agent API keys are scoped to one space and one agent. Plaintext tokens are printed once at creation.

```sh
npx @outpost/cli token agent create --space-id <space-id> --agent <agent-id-or-name> --name external-worker
npx @outpost/cli token agent list --space-id <space-id> --agent <agent-id-or-name>
npx @outpost/cli token agent revoke --space-id <space-id> --agent <agent-id-or-name> <key-id>
```

Named board API keys use the board authorization model, support revocation and expiration metadata, and are audited server-side.

```sh
npx @outpost/cli token board create --space-id <space-id> --name external-admin
npx @outpost/cli token board create --name short-lived --ttl-days 7
npx @outpost/cli token board list
npx @outpost/cli token board revoke <key-id>
```

## Run Commands

`outpost run` without a subcommand still bootstraps and starts a local Outpost instance. The subcommands below inspect and control API heartbeat runs.

```sh
npx @outpost/cli run list --space-id <space-id> [--agent-id <agent-id>] [--limit 50]
npx @outpost/cli run live --space-id <space-id> [--limit 50] [--min-count 0]
npx @outpost/cli run get <run-id>
npx @outpost/cli run events <run-id> [--after-seq 0] [--limit 200]
npx @outpost/cli run log <run-id> [--offset 0] [--limit-bytes 16384] [--text]
npx @outpost/cli run cancel <run-id>
npx @outpost/cli run issues <run-id>
npx @outpost/cli run workspace-operations <run-id>
npx @outpost/cli run workspace-log <operation-id> [--offset 0] [--limit-bytes 16384] [--text]
npx @outpost/cli run watchdog-decision <run-id> --decision continue [--reason "..."]
```

## Routine Commands

`outpost routines disable-all` remains the local maintenance command. The singular `routine` group maps to the REST API.

```sh
npx @outpost/cli routine list --space-id <space-id> [--project-id <project-id>]
npx @outpost/cli routine create --space-id <space-id> --payload-json '{...}'
npx @outpost/cli routine get <routine-id>
npx @outpost/cli routine update <routine-id> --payload-json '{...}'
npx @outpost/cli routine revisions <routine-id>
npx @outpost/cli routine revision:restore <routine-id> <revision-id>
npx @outpost/cli routine runs <routine-id> [--limit 50]
npx @outpost/cli routine run <routine-id> [--payload-json '{...}']
npx @outpost/cli routine trigger:create <routine-id> --payload-json '{...}'
npx @outpost/cli routine trigger:update <trigger-id> --payload-json '{...}'
npx @outpost/cli routine trigger:delete <trigger-id>
npx @outpost/cli routine trigger:rotate-secret <trigger-id>
npx @outpost/cli routine trigger:fire <public-id> [--payload-json '{...}']
```

## Prompt Handoff

Prompt handoff creates Outpost work. It does not create a chat session.

```sh
npx @outpost/cli agent-prompt <agent-name-or-id> <agent-api-key> "Prompt here"
npx @outpost/cli agent prompt --agent <agent-name-or-id> --api-key-env OUTPOST_API_KEY "Prompt here"
npx @outpost/cli agent prompt --profile my-agent "Prompt here"
npx @outpost/cli board prompt --space-id <space-id> --agent <agent-name-or-id> "Prompt here"
```

By default the command creates a `todo` issue assigned to the target agent and wakes the agent. Use `--issue <issue-id>` to add a comment to existing work, and `--no-wake` to skip the wakeup.

## Skills Commands

`outpost skills` covers three distinct operations:

1. **Space install** — adds or updates a row in `space_skills` for the
   whole space. This is what `skills install`, `skills import`, `skills create`,
   and `skills scan-projects` do.
2. **Agent attach** — merges an agent's *desired* space skill set with an
   explicit `add`, `remove`, or `replace` mode (`skills agent sync`/`clear`).
   This is a desired-state operation on the agent's adapter config; it does not
   change the space library.
3. **Adapter runtime sync** — the adapter reconciles the desired skill set
   with files on disk and reports an `AgentSkillSnapshot` (`skills agent list`).
   `skills agent sync` triggers this automatically after updating desired state.

Required Outpost runtime skills (heartbeat, etc.) remain server-enforced and
are added on top of whatever the desired set names.

Space skill mutations (`skills install`, `skills import`, `skills create`, and
`skills scan-projects`) are open to same-space actors by default. Missing
`skills:create` grants and `canCreateSkills` settings do not deny these commands;
only an explicit space skill policy restriction does. Core safety and space
boundary checks still apply, and `agents:create` remains required when a command
also creates agents.

### Space library

```sh
npx @outpost/cli skills list --space-id <space-id>
npx @outpost/cli skills show <skill-id-or-key-or-slug> --space-id <space-id>
npx @outpost/cli skills file <skill-id-or-key-or-slug> [--path SKILL.md] --space-id <space-id>
npx @outpost/cli skills import <source> --space-id <space-id>
npx @outpost/cli skills create --name "Review PRs" [--slug review-prs] [--description "..."] [--body-file SKILL.md] --space-id <space-id>
npx @outpost/cli skills scan-projects [--project-id <id>...] [--workspace-id <id>...] --space-id <space-id>
npx @outpost/cli skills check [skill-id-or-key-or-slug] --space-id <space-id>
npx @outpost/cli skills update <skill-id-or-key-or-slug> [--force] --space-id <space-id>
npx @outpost/cli skills update --all [--force] --space-id <space-id>
npx @outpost/cli skills audit [skill-id-or-key-or-slug] --space-id <space-id>
npx @outpost/cli skills remove <skill-id-or-key-or-slug> --yes --space-id <space-id>
```

`skills import <source>` accepts a skills.sh URL, the equivalent
`<owner>/<repo>/<skill>` shorthand, a GitHub URL, a local path, or an
`npx skills add …` command. See `references/space-skills.md` in the agent
skill bundle for the source-type table.

`skills check`, `skills update`, and `skills audit` are the maintenance loop
for imported skills:

- `check` reports whether each skill's installed bytes match its pinned origin
  (`hasUpdate`, `installedHash`, `originHash`, `updateHoldReason`,
  `auditVerdict`).
- `update` installs the pinned update through the existing install-update API.
  `--all` checks every space skill and updates only those with
  `hasUpdate=true`. `--force` discards local-modification or soft-audit holds;
  hard-stop audit findings still block the update.
- `audit` re-scans installed bytes and reports findings without executing
  anything.

### Agent attach

```sh
npx @outpost/cli skills agent list <agent-id-or-shortname> --space-id <space-id>
npx @outpost/cli skills agent sync <agent-id-or-shortname> --skill <skill-id-or-key-or-slug> [--skill <skill-id-or-key-or-slug>...] --mode <add|remove|replace> --space-id <space-id>
npx @outpost/cli skills agent clear <agent-id-or-shortname> --yes --space-id <space-id>
```

`skills agent sync` requires a merge mode and returns the resulting adapter
`AgentSkillSnapshot`. `add` preserves all unnamed assignments, `remove` deletes
only named assignments, and `replace` destructively overwrites the complete
non-required desired skill set.
`skills agent clear` sends an empty desired list. Required Outpost skills are
still enforced by the server in both cases.

### Notes

- Skill references accept space skill `id`, canonical `key`, or unique `slug`.
- `skills file` prints raw file content in human mode so it can be piped.
- `skills create --body-file -` reads the skill markdown body from stdin.
- `skills remove` and `skills agent clear` prompt in a TTY and
  require `--yes` in non-interactive use.
- `--json` prints the raw API result for each command.

## Secrets Commands

```sh
npx @outpost/cli secrets list --space-id <space-id>
npx @outpost/cli secrets declarations --space-id <space-id> [--include agents,projects] [--kind secret]
npx @outpost/cli secrets create --space-id <space-id> --name anthropic-api-key --value-env ANTHROPIC_API_KEY
npx @outpost/cli secrets link --space-id <space-id> --name prod-stripe-key --provider aws_secrets_manager --external-ref <provider-ref>
npx @outpost/cli secrets doctor --space-id <space-id>
npx @outpost/cli secrets provider-configs --space-id <space-id>
npx @outpost/cli secrets provider-config:create --space-id <space-id> --payload-json '{...}'
npx @outpost/cli secrets provider-config:discovery-preview --space-id <space-id> --payload-json '{...}'
npx @outpost/cli secrets provider-config:get <config-id>
npx @outpost/cli secrets provider-config:update <config-id> --payload-json '{...}'
npx @outpost/cli secrets provider-config:default <config-id>
npx @outpost/cli secrets provider-config:health <config-id>
npx @outpost/cli secrets provider-config:delete <config-id>
npx @outpost/cli secrets remote-import:preview --space-id <space-id> --payload-json '{...}'
npx @outpost/cli secrets remote-import --space-id <space-id> --payload-json '{...}'
npx @outpost/cli secrets migrate-inline-env --space-id <space-id> [--apply]
```

Secret listing and declarations never print secret values. `create` accepts
`--value-env` so shell history does not capture the value. `link` records
provider-owned references without copying the secret value into Outpost.
For AWS-backed secrets, `secrets doctor` reports missing non-secret provider
env and the expected AWS SDK runtime credential source; do not store AWS
bootstrap credentials in Outpost secrets.

Per-space provider vaults (multiple vault instances per provider, default
vault selection, coming-soon GCP/Vault) can be configured from the board UI under
`Organization Settings → Secrets → Provider vaults` or through the provider-config CLI
commands above. See the
[secrets deploy guide](../docs/deploy/secrets.md#provider-vaults) and
[API reference](../docs/api/secrets.md#provider-vaults) for the contract.

## Approval Commands

```sh
npx @outpost/cli approval list --space-id <space-id> [--status pending]
npx @outpost/cli approval get <approval-id>
npx @outpost/cli approval create --space-id <space-id> --type hire_agent --payload '{"name":"..."}' [--issue-ids <id1,id2>]
npx @outpost/cli approval approve <approval-id> [--decision-note "..."]
npx @outpost/cli approval reject <approval-id> [--decision-note "..."]
npx @outpost/cli approval request-revision <approval-id> [--decision-note "..."]
npx @outpost/cli approval resubmit <approval-id> [--payload '{"...":"..."}']
npx @outpost/cli approval comment <approval-id> --body "..."
```

## Activity Commands

```sh
npx @outpost/cli activity list --space-id <space-id> [--agent-id <agent-id>] [--entity-type issue] [--entity-id <id>]
npx @outpost/cli activity create --space-id <space-id> --payload-json '{...}'
npx @outpost/cli activity issue <issue-id>
```

## Dashboard Commands

```sh
npx @outpost/cli dashboard get --space-id <space-id>
```

## Org And Agent Config Commands

```sh
npx @outpost/cli whoami
npx @outpost/cli openapi
npx @outpost/cli org get --space-id <space-id>
npx @outpost/cli org svg --space-id <space-id> [--out org.svg]
npx @outpost/cli org png --space-id <space-id> [--out org.png]
npx @outpost/cli agent-config list --space-id <space-id>
```

## Access, Profile, And Instance Commands

```sh
npx @outpost/cli profile session
npx @outpost/cli profile get
npx @outpost/cli profile update --payload-json '{...}'
npx @outpost/cli profile space-user <user-slug> --space-id <space-id>
npx @outpost/cli invite list --space-id <space-id>
npx @outpost/cli invite create --space-id <space-id> --payload-json '{...}'
npx @outpost/cli invite revoke <invite-id>
npx @outpost/cli invite show <token>
npx @outpost/cli invite accept <token> [--payload-json '{...}']
npx @outpost/cli invite onboarding:text <token>
npx @outpost/cli join list --space-id <space-id> [--status pending_approval]
npx @outpost/cli join approve <request-id> --space-id <space-id>
npx @outpost/cli join reject <request-id> --space-id <space-id>
npx @outpost/cli join claim-key <request-id> --claim-secret <secret>
npx @outpost/cli member list --space-id <space-id>
npx @outpost/cli member update <member-id> --space-id <space-id> --payload-json '{...}'
npx @outpost/cli member role-and-grants <member-id> --space-id <space-id> --payload-json '{...}'
npx @outpost/cli member permissions <member-id> --space-id <space-id> --payload-json '{...}'
npx @outpost/cli member archive <member-id> --space-id <space-id> [--payload-json '{...}']
npx @outpost/cli admin user list [--query <text>]
npx @outpost/cli admin user promote <user-id>
npx @outpost/cli admin user demote <user-id>
npx @outpost/cli admin user space-access <user-id>
npx @outpost/cli admin user space-access:update <user-id> --payload-json '{...}'
```

CLI auth challenge endpoints are also exposed for tooling that needs the raw challenge lifecycle:

```sh
npx @outpost/cli auth challenge create --payload-json '{...}'
OUTPOST_CHALLENGE_SECRET=<challenge-secret> npx @outpost/cli auth challenge get <challenge-id> --token-env OUTPOST_CHALLENGE_SECRET
OUTPOST_CHALLENGE_SECRET=<challenge-secret> npx @outpost/cli auth challenge approve <challenge-id> --token-env OUTPOST_CHALLENGE_SECRET
OUTPOST_CHALLENGE_SECRET=<challenge-secret> npx @outpost/cli auth challenge cancel <challenge-id> --token-env OUTPOST_CHALLENGE_SECRET
npx @outpost/cli auth revoke-current
```

`--token <challenge-secret>` is still supported for compatibility, but `--token-env` avoids putting challenge secrets in shell history or process arguments.

Use the challenge UUID returned by `auth challenge create` for get, approve, and
cancel. With the required secret and approval authentication present, malformed
IDs return HTTP 400 before database access. A status request without a secret
returns HTTP 404. Unknown challenges or incorrect challenge secrets still return
HTTP 404. Approval requires board authentication, checked before ID validation.

## Instance Settings Commands

```sh
npx @outpost/cli instance scheduler-heartbeats
npx @outpost/cli instance settings:general
npx @outpost/cli instance settings:general:update --payload-json '{...}'
npx @outpost/cli instance settings:experimental
npx @outpost/cli instance settings:experimental:update --payload-json '{...}'
npx @outpost/cli instance database-backup
```

Experimental features are opt-in and are provided without compatibility guarantees. They may break, change, or be removed at any time. Use them at your own risk.

```sh
npx @outpost/cli sidebar preferences
npx @outpost/cli sidebar preferences:update --payload-json '{...}'
npx @outpost/cli sidebar project-preferences --space-id <space-id>
npx @outpost/cli sidebar project-preferences:update --space-id <space-id> --payload-json '{...}'
npx @outpost/cli sidebar badges --space-id <space-id>
npx @outpost/cli inbox dismissals --space-id <space-id>
npx @outpost/cli inbox dismiss --space-id <space-id> --payload-json '{"itemKey":"run:<run-id>"}'
npx @outpost/cli board-claim show <token>
npx @outpost/cli board-claim claim <token> [--payload-json '{...}']
npx @outpost/cli available-skill list
npx @outpost/cli available-skill index
npx @outpost/cli available-skill get <skill-name>
npx @outpost/cli llm agent-configuration
npx @outpost/cli llm agent-configuration:adapter <adapter-type>
npx @outpost/cli llm agent-icons
```

## Adapter, Asset, And Skill Commands

```sh
npx @outpost/cli adapter list
npx @outpost/cli adapter install --payload-json '{"packageName":"@scope/adapter","version":"1.2.3"}'
npx @outpost/cli adapter get <adapter-type>
npx @outpost/cli adapter update <adapter-type> --payload-json '{"disabled":true}'
npx @outpost/cli adapter override <adapter-type> --payload-json '{"paused":true}'
npx @outpost/cli adapter reload <adapter-type>
npx @outpost/cli adapter reinstall <adapter-type>
npx @outpost/cli adapter delete <adapter-type>
npx @outpost/cli adapter config-schema <adapter-type>
npx @outpost/cli adapter ui-parser <adapter-type>
npx @outpost/cli adapter models <adapter-type> --space-id <space-id> [--refresh] [--environment-id <id>]
npx @outpost/cli adapter detect-model <adapter-type> --space-id <space-id>
npx @outpost/cli adapter test-environment <adapter-type> --space-id <space-id> --payload-json '{...}'
```

```sh
npx @outpost/cli asset image:upload --space-id <space-id> --file ./image.png [--namespace docs] [--alt "..."]
npx @outpost/cli asset logo:upload --space-id <space-id> --file ./logo.svg
npx @outpost/cli asset content <asset-id> --out ./asset.bin
```

```sh
npx @outpost/cli skill list --space-id <space-id>
npx @outpost/cli skill get <skill-id> --space-id <space-id>
npx @outpost/cli skill file <skill-id> --space-id <space-id> [--path SKILL.md]
npx @outpost/cli skill create --space-id <space-id> --payload-json '{...}'
npx @outpost/cli skill file:update <skill-id> --space-id <space-id> --payload-json '{...}'
npx @outpost/cli skill import --space-id <space-id> --payload-json '{"source":"github:owner/repo/path"}'
npx @outpost/cli skill scan-projects --space-id <space-id> --payload-json '{...}'
npx @outpost/cli skill update-status <skill-id> --space-id <space-id>
npx @outpost/cli skill install-update <skill-id> --space-id <space-id>
npx @outpost/cli skill delete <skill-id> --space-id <space-id>
```

## Cost, Finance, And Budget Commands

```sh
npx @outpost/cli cost summary --space-id <space-id>
npx @outpost/cli cost by-agent --space-id <space-id>
npx @outpost/cli cost by-agent-model --space-id <space-id>
npx @outpost/cli cost by-provider --space-id <space-id>
npx @outpost/cli cost by-biller --space-id <space-id>
npx @outpost/cli cost by-project --space-id <space-id>
npx @outpost/cli cost window-spend --space-id <space-id>
npx @outpost/cli cost quota-windows --space-id <space-id>
npx @outpost/cli cost issue <issue-id>
npx @outpost/cli cost event:create --space-id <space-id> --payload-json '{...}'
```

```sh
npx @outpost/cli finance event:create --space-id <space-id> --payload-json '{...}'
npx @outpost/cli finance events --space-id <space-id>
npx @outpost/cli finance summary --space-id <space-id>
npx @outpost/cli finance by-biller --space-id <space-id>
npx @outpost/cli finance by-kind --space-id <space-id>
npx @outpost/cli budget overview --space-id <space-id>
npx @outpost/cli budget policy:upsert --space-id <space-id> --payload-json '{...}'
npx @outpost/cli budget space:update --space-id <space-id> --payload-json '{...}'
npx @outpost/cli budget agent:update <agent-id> --payload-json '{...}'
npx @outpost/cli budget incident:resolve <incident-id> --space-id <space-id> [--payload-json '{...}']
```

## Workspace And Environment Commands

```sh
npx @outpost/cli workspace list --space-id <space-id>
npx @outpost/cli workspace get <execution-workspace-id>
npx @outpost/cli workspace close-readiness <execution-workspace-id>
npx @outpost/cli workspace operations <execution-workspace-id>
npx @outpost/cli workspace update <execution-workspace-id> --payload-json '{...}'
npx @outpost/cli workspace runtime-service <execution-workspace-id> start --payload-json '{...}'
npx @outpost/cli workspace runtime-command <execution-workspace-id> run --payload-json '{...}'
```

```sh
npx @outpost/cli environment list --space-id <space-id>
npx @outpost/cli environment capabilities --space-id <space-id>
npx @outpost/cli environment create --space-id <space-id> --payload-json '{...}'
npx @outpost/cli environment get <environment-id>
npx @outpost/cli environment leases <environment-id>
npx @outpost/cli environment lease <lease-id>
npx @outpost/cli environment update <environment-id> --payload-json '{...}'
npx @outpost/cli environment delete <environment-id>
npx @outpost/cli environment probe <environment-id>
npx @outpost/cli environment probe-config --space-id <space-id> --payload-json '{...}'
```

```sh
npx @outpost/cli project-workspace list <project-id>
npx @outpost/cli project-workspace create <project-id> --payload-json '{...}'
npx @outpost/cli project-workspace update <project-id> <workspace-id> --payload-json '{...}'
npx @outpost/cli project-workspace delete <project-id> <workspace-id>
npx @outpost/cli project-workspace runtime-service <project-id> <workspace-id> restart --payload-json '{...}'
npx @outpost/cli project-workspace runtime-command <project-id> <workspace-id> run --payload-json '{...}'
```

## Plugin Commands

Existing plugin lifecycle commands remain available: `plugin list`, `install`, `uninstall`, `enable`, `disable`, `inspect`, and `examples`.

```sh
npx @outpost/cli plugin ui-contributions
npx @outpost/cli plugin tools
npx @outpost/cli plugin tool:execute --payload-json '{...}'
npx @outpost/cli plugin health <plugin-id>
npx @outpost/cli plugin logs <plugin-id>
npx @outpost/cli plugin upgrade <plugin-id>
npx @outpost/cli plugin config <plugin-id> --space-id <space-id>
npx @outpost/cli plugin config:set <plugin-id> --space-id <space-id> --payload-json '{"configJson":{...}}'
npx @outpost/cli plugin config:test <plugin-id> --space-id <space-id> --payload-json '{"configJson":{...}}'
npx @outpost/cli plugin jobs <plugin-id>
npx @outpost/cli plugin job:runs <plugin-id> <job-id>
npx @outpost/cli plugin job:trigger <plugin-id> <job-id> [--payload-json '{...}']
npx @outpost/cli plugin webhook <plugin-id> <endpoint-key> [--payload-json '{...}']
npx @outpost/cli plugin dashboard <plugin-id>
npx @outpost/cli plugin bridge:data <plugin-id> --payload-json '{...}'
npx @outpost/cli plugin bridge:action <plugin-id> --payload-json '{...}'
npx @outpost/cli plugin bridge:stream <plugin-id> <channel> [--duration-ms 10000]
npx @outpost/cli plugin data <plugin-id> <key> --payload-json '{...}'
npx @outpost/cli plugin action <plugin-id> <key> --payload-json '{...}'
npx @outpost/cli plugin local-folders <plugin-id> --space-id <space-id>
npx @outpost/cli plugin local-folder:status <plugin-id> <folder-key> --space-id <space-id>
npx @outpost/cli plugin local-folder:validate <plugin-id> <folder-key> --space-id <space-id> [--payload-json '{...}']
npx @outpost/cli plugin local-folder:set <plugin-id> <folder-key> --space-id <space-id> --payload-json '{...}'
```

Feedback traces can be fetched directly by ID when automating export workflows:

```sh
npx @outpost/cli feedback trace <trace-id>
npx @outpost/cli feedback bundle <trace-id>
```

## Heartbeat Command

`heartbeat run` now also supports context/api-key options and uses the shared client stack:

```sh
npx @outpost/cli heartbeat run --agent-id <agent-id> [--api-base http://localhost:3100] [--api-key <token>]
```

## Local Storage Defaults

Local Outpost data lives under the selected instance root. `OUTPOST_HOME` chooses the home directory and `OUTPOST_INSTANCE_ID` chooses the instance.

```text
~/.outpost/                                     # OUTPOST_HOME
└── instances/
    └── default/                                  # instance root (OUTPOST_INSTANCE_ID)
        ├── config.json                           # runtime config
        ├── .env                                  # instance env file
        ├── db/                                   # embedded PostgreSQL data
        ├── data/
        │   ├── storage/                          # local_disk uploads
        │   └── backups/                          # automatic DB backups
        ├── logs/
        ├── secrets/
        │   └── master.key                        # local_encrypted master key
        ├── workspaces/                           # default agent workspaces
        ├── projects/                             # project execution workspaces
        ├── spaces/                            # per-space adapter homes (e.g. codex-home)
        └── codex-home/                           # per-instance codex home (when not space-scoped)
```

Default paths for the canonical install:

- config: `~/.outpost/instances/default/config.json`
- embedded db: `~/.outpost/instances/default/db`
- logs: `~/.outpost/instances/default/logs`
- storage: `~/.outpost/instances/default/data/storage`
- secrets key: `~/.outpost/instances/default/secrets/master.key`

Override base home or instance with env vars:

```sh
OUTPOST_HOME=/custom/home OUTPOST_INSTANCE_ID=dev pnpm outpost run
```

## Storage Configuration

Configure storage provider and settings:

```sh
pnpm outpost configure --section storage
```

Supported providers:

- `local_disk` (default; local single-user installs)
- `s3` (S3-compatible object storage)

When a challenge poll receives HTTP 429, the CLI waits for `Retry-After` and
continues the same challenge. A missing or invalid value uses the normal poll
interval. The wait never extends the original challenge deadline and never
creates another challenge or key. This allows concurrent logins on a shared IP
to complete after the process-local limit clears.

Revocation records use the current key owner and trusted original creation or
approved-challenge space context. Removing a space membership does not
remove that audit history. Revocation and its audit records commit together;
an audit failure leaves the key unchanged so the operation can be retried.
Historical creation rows with a NULL responsible user do not provide trusted
revocation context. The original approved challenge or current authorized
space context can still provide that destination. Client-supplied activity
rows cannot establish key ownership or a revocation audit destination.
