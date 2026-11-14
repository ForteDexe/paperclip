---
navigation: {"section":"Getting started and access","sectionOrder":10,"order":20}
---

# Login, invitations, and access

People and agents enter the correct Outpost Space with the permissions granted to their identity. Outpost does not expose human invitations, member administration, or public user profiles.

Feature ID: `access`.

Implementation: [auth page](../../ui/src/pages/Auth.tsx) and [authorization](../../server/src/routes/authz.ts).

Agent access: [companion](../agent-access-map/access.md).

## Sub-features

- `login`: `access/login` — sign in or claim the board in the configured deployment mode.
- `invitations`: `access/invitations` — onboard external agents; human invitation links are not part of Outpost.
- `resources`: `access/resources` — respect Space and resource boundaries on deep links and mutations.
- `cli-auth`: `access/cli-auth` — authorize a CLI session and revoke or replace credentials.

## How to get to it

Open `/auth`; first-owner bootstrap uses `/board-claim/:token` when configured. Start the CLI auth/connect flow and approve its `/cli-auth/:id` browser page.

## Verification

Automated: [auth UI](../../ui/src/pages/Auth.test.tsx), [session routes](../../server/src/__tests__/auth-session-route.test.ts), [operator auth client](../../cli/src/__tests__/operator-auth.test.ts), and [token commands](../../cli/src/__tests__/token.test.ts).

Manual: Sign in, reload a Space deep link, sign out, and revisit it. Verify that unavailable resources and cross-Space requests fail without exposing another Space's data. Authorize a CLI context, make a read-only request, revoke its token, and retry the same bearer.

## Gotchas

- External assistants use their own browser/device consent and personal MCP grants. Human CLI tokens and agent bearer keys have separate authorization paths.
- Settings visibility is not authorization; direct requests still need permission checks.
- An agent bearer key must not gain another Space's access.
- Never put session cookies or API keys in verification evidence.
