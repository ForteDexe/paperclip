---
name: outpost-artifact
description: Deliver screenshots, reports, builds, or other generated files as task-grouped Outpost Artifacts for human inspection or final handoff.
---

# Outpost Artifact

Use this skill when the human needs to inspect or download a generated file.
Source changes already present in the Space repository are not Artifacts by
themselves.

Artifacts belong to the current task. Use clear titles that include a stage or
purpose, such as `Stage 1 - before` and `Stage 1 - after`, so several results on
one task remain understandable.

The upload helper stores the file as a task attachment and registers an
attachment-backed work product. Treat its output as the delivery receipt; a
local path alone is not delivery.

Read [references/api-reference.md](references/api-reference.md) before upload.

