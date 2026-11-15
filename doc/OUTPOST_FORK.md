# Outpost fork policy

Outpost is the user-facing product name. It keeps Outpost's internal package names, command name, API paths and fields, database tables, environment variables, migrations, and data-directory layout so existing installations remain readable and upgradeable.

## Visible terminology

| Upstream wording | Outpost wording |
| --- | --- |
| Outpost | Outpost |
| organization / space | outpost |
| organization members | crew |
| org chart | crew map |
| CEO | Outpost Lead |
| CTO | Engineering Lead |
| Goal | North Star |
| conference room | Campfire |

Campfire remains the shared group-chat feature. Its persistent native-session identity and deliberate no-context-size-rotation behavior are unchanged.

## Removed product behavior

- Dollar-denominated spend and budget surfaces are hidden, and monetary enforcement is disabled. Existing database columns, migrations, and stored rows remain intact.
- Vendor telemetry and feedback export are removed. Hosted tracing and crash uploads remain disabled by default. Local logs, local feedback votes, audit activity, and functional provider events remain.
- Automatic update checks are disabled. Explicit update commands remain available for compatibility.
