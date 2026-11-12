# Speko Outpost Phone Agent

This optional [Outpost](https://github.com/paperclipai/paperclip) catalog template provides one Outpost Phone Agent for voice intake and task follow-up. It follows [agentcompanies/v1](https://agentcompanies.io/specification).

The agent receives authorized requests on a bound task, clarifies the request, works with existing Outpost agents when needed, and publishes concise results. It has no bundled credentials, runtime override, external skills, or automatic outbound calling permission.

## Getting started

Select this template from Outpost's team catalog, review the proposed agent, and choose its runtime before installation. Then select the agent in the Speko connection setup. Speko setup selects an existing agent and does not recommend installing this template. Every assigned agent automatically receives the connection’s voice guidance; this template is only for Outposts that separately want a dedicated receptionist. Existing task assignments are preserved.

For a filesystem import, run `paperclipai company import --from packages/teams-catalog/catalog/optional/communications/speko-company-phone-agent/TEAM.md` from the repository root and review the import before applying it.

## Agent

- **Speko Outpost Phone Agent** — the single root agent; greeting, intake, clarification, authorized delegation, and concise follow-up. No additional skills are required.
