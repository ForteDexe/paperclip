# Plugin Authoring Smoke Example

An Outpost plugin

## Development

```bash
pnpm install
pnpm dev            # watch builds
pnpm dev:ui         # local dev server with hot-reload events
pnpm test
```

## Install Into Outpost

```bash
npx @outpost/cli plugin install ./
```

## Build Options

- `pnpm build` uses esbuild presets from `@outpost/plugin-sdk/bundlers`.
- `pnpm build:rollup` uses rollup presets from the same SDK.
