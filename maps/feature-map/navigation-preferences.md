---
navigation: {"section":"Oversight and operation","sectionOrder":70,"order":30}
---

# Navigation and preferences

People organize their sidebar and move between Space resources with the correct
persistence and identity scope. Outpost does not expose public user profiles or
profile editing.

Feature ID: `navigation-preferences`.

Implementation: [sidebar](../../ui/src/components/Sidebar.tsx).

Agent access: [companion](../agent-access-map/navigation-preferences.md).

## Sub-features

- `navigation`: `navigation-preferences/navigation` — use current sidebar links, favorites, recents, and available layout controls.
- `preferences`: `navigation-preferences/preferences` — persist supported ordering and collapse choices for the intended user and Space.
- `profile`: `navigation-preferences/profile` — inspect and configure agent persona surfaces; public human profiles and human profile editing are not part of Outpost.
- `fallbacks`: `navigation-preferences/fallbacks` — handle missing resources and retired deep links without presenting another resource as the target.
- `command-palette`: `navigation-preferences/command-palette` — open quick search and creation actions with keyboard shortcuts, then carry query and filter intent into full search.

## Verification

Automated: [sidebar](../../ui/src/components/Sidebar.test.tsx), [sidebar preference routes](../../server/src/__tests__/sidebar-preferences-routes.test.ts), and [command palette](../../ui/src/components/CommandPalette.test.tsx).

Manual: Star and reorder supported resources, navigate and reload, then switch Space and inspect the intended preference scope. Open an unavailable resource or retired human-profile/member URL and verify a clear canonical redirect without leaking another Space's state.

## Gotchas

- A route redirect is part of the journey; do not document a removed screen as if it still renders.
- Outpost has one streamlined shell; legacy shell preferences are compatibility data only.
