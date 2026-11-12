# Campfire for Paperclip

Campfire is a Paperclip plugin for persistent, multi-agent development rooms.
Each Paperclip agent may be booked into one room at a time. The plugin stores
room membership, messages, delivery receipts, and the current native agent
session in its company-scoped database namespace.

## Current vertical slice

- Create explicitly named rooms; no misleading default room is created.
- Associate a room with the active Paperclip project when created from project context.
- Invite existing Paperclip agents and give each a stable room handle.
- Enforce one-room-at-a-time agent booking.
- Send to every room member by default or only named `@handles`.
- Create one persistent Paperclip agent session per booked agent and room.
- Send only the new message on later turns; the native Codex/Claude session retains context.
- Keep that session stable across turns; Campfire does not rotate it for context size.
- Stream agent activity and persist final replies into the room feed.
- Remove an agent and close its persistent session.

## Local development

From the Paperclip repository root:

```powershell
corepack pnpm install --ignore-scripts
corepack pnpm --filter @paperclipai/plugin-sdk ensure-build-deps
corepack pnpm --filter @forted/plugin-campfire exec node ./esbuild.config.mjs
corepack pnpm --filter @forted/plugin-campfire exec vitest run
corepack pnpm paperclipai run
```

`--ignore-scripts` avoids Paperclip's optional excluded-plugin symlink setup,
which requires Windows Developer Mode or an elevated shell. It is not needed
to build or run Campfire.

In a second terminal, install the local plugin into the running instance:

```powershell
corepack pnpm paperclipai plugin install "$PWD\packages\plugins\plugin-campfire" --local
corepack pnpm paperclipai plugin inspect forted.campfire
```

Open **Campfire** in the Paperclip sidebar, create a room for a development
scope, invite at least one configured Codex or Claude agent, and send a message.

## Deliberately deferred

This first slice does not yet port Campfire peer follow-up rounds, unread CLI
cursors/history search, room rename/delete/settings, or chat-to-task promotion.
Those build on the durable room/session foundation here.
