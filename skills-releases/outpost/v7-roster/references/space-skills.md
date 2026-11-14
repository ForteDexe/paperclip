# Space skills

Space skills are imported from a local path, GitHub, `skills.sh`, or a URL, then
attached to an agent explicitly. Outpost does not provide a public skill
marketplace.

```sh
outpost skills list --space-id "$OUTPOST_SPACE_ID"
outpost skills import ./skills/example --space-id "$OUTPOST_SPACE_ID"
outpost skills agent sync "$OUTPOST_AGENT_ID" --skill example --mode add --space-id "$OUTPOST_SPACE_ID"
```

Importing changes the space library. Agent sync changes the agent's desired
skill set. Keep those steps separate and preserve existing assignments unless
the user explicitly requests replacement.
