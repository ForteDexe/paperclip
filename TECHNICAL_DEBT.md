# Outpost Technical Debt

This document records compatibility code that is intentionally retained after
the Outpost product-surface cleanup. These items are not active product bugs or
current test failures.

## Unsupported agent providers

The product currently exposes only Codex and Claude, but implementation,
schema, and runner packages for older providers still exist for historical
record compatibility.

Do not remove these piecemeal. Revisit them as a deliberate package and schema
migration after deciding whether existing databases must remain readable and
resumable. The migration should include a data audit, explicit handling for old
provider records, package removal, and full runtime validation.

## Coupled runtime and database systems

Routines and schedulers, execution-workspace internals, environment and secret
schemas, and historical migrations remain coupled to agent execution and stored
history. Some corresponding user-facing surfaces have been retired, but that
does not prove the underlying runtime or persistence code is unused.

Before removing any of these systems, map their callers, database relations,
background jobs, and agent-runtime dependencies. Remove them only through a
focused migration with end-to-end agent execution and restart/recovery tests.

## Historical feature maps

Several feature-map documents describe retired surfaces. They are intentionally
kept and updated to identify those surfaces as retired rather than linking to
deleted tests.

Keep these documents while they help explain historical compatibility code and
prevent retired features from being restored accidentally. Archive or remove
them only when the related compatibility code and migrations are also gone.

## Revisit condition

Return to this cleanup after the main Outpost workflow and Campfire work
end-to-end. At that point, make each area a separate, reversible migration
rather than combining it with feature development.
