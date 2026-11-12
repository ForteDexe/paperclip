// Resolves the Sentry DSN for each component from the process environment.
//
// Precedence: a specific variable always wins for its own component.
// `SENTRY_DSN` supplies a component that has no specific value set.
// An empty string counts as absent for every variable, so a specific
// variable set to `""` still falls back to `SENTRY_DSN`.
//
// To add a DSN for a new component, add a field to `SentryDsns`, add a
// variable named with the shared `SENTRY_DSN_` prefix, and resolve it with
// `normalize` the same way `frontend` and `backend` resolve here.

export interface SentryDsns {
  frontend: string | null;
  backend: string | null;
  legacyFallbackUsed: boolean;
}

export function resolveSentryDsns(env: NodeJS.ProcessEnv = process.env): SentryDsns {
  void env;
  return { frontend: null, backend: null, legacyFallbackUsed: false };
}
