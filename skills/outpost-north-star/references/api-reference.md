# North Star API

| Action | Method | Endpoint |
| --- | --- | --- |
| List in Space | `GET` | `/api/spaces/:spaceId/goals` |
| Read | `GET` | `/api/goals/:id` |
| Create | `POST` | `/api/spaces/:spaceId/goals` |
| Update | `PATCH` | `/api/goals/:id` |
| Delete | `DELETE` | `/api/goals/:id` |

Create example:

```json
{
  "title": "Make agent work easy to inspect",
  "description": "Every result should remain understandable after the session ends.",
  "level": "space",
  "status": "active"
}
```

Internal APIs still call North Stars `goals`. Valid levels are `space`,
`team`, `agent`, and `task`; valid states are `planned`, `active`, `achieved`,
and `cancelled`.

