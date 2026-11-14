---
title: Quickstart
summary: Get Outpost running in minutes
---

Get Outpost running locally in under 5 minutes.

## Quick Start (Recommended)

```sh
npx @outpost/cli onboard --yes
```

This walks you through setup, configures your environment, and gets Outpost running.

If you already have a Outpost install, rerunning `onboard` keeps your current config and data paths intact. Use `outpost configure` if you want to edit settings.

To start Outpost again later:

```sh
npx @outpost/cli run
```

> **Note:** If you used `npx` for setup, always use `npx @outpost/cli` to run commands. The `pnpm outpost` form only works inside a cloned copy of the Outpost repository (see Local Development below).

## Local Development

For contributors working on Outpost itself. Prerequisites: Node.js 24.11+ and pnpm 9+.

Clone the repository, then:

```sh
pnpm install
pnpm dev
```

This starts the API server and UI at [http://localhost:3100](http://localhost:3100).

No external database required — Outpost uses an embedded PostgreSQL instance by default.

When working from the cloned repo, you can also use:

```sh
pnpm outpost run
```

This auto-onboards if config is missing, runs health checks with auto-repair, and starts the server.

## What's Next

Once Outpost is running:

1. Create your first space in the web UI
2. Define a space goal
3. Create a CEO agent and configure its adapter
4. Build out the org chart with more agents
5. Set budgets and assign initial tasks
6. Hit go — agents start their heartbeats and the space runs

<Card title="Core Concepts" href="/start/core-concepts">
  Learn the key concepts behind Outpost
</Card>
