# Hermes Gateway Adapter Compatibility Shim

`@outpost/adapter-hermes-gateway` is a deprecated compatibility shim.

Use `@outpost/hermes-outpost-adapter` for new installs and import gateway
entrypoints from `@outpost/hermes-outpost-adapter/gateway`. The adapter
type remains `hermes_gateway`; only package ownership changed.

`hermes_gateway` is for an already-running Hermes API server. It does not start
the local Hermes CLI. If Outpost should launch local `hermes chat` as a child
process, use `hermes_local` from `@outpost/hermes-outpost-adapter`
instead.

The shim preserves the legacy exports for one release:

- `.`
- `./server`
- `./ui`
- `./cli`
- `./ui-parser`

These exports forward to the unified Hermes package. Existing
`@outpost/adapter-hermes-gateway` plugin installs should continue to load
during the compatibility window, but should migrate to
`@outpost/hermes-outpost-adapter` before the shim is removed.
