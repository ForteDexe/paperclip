# North Star API

| Action | Method | Endpoint |
| --- | --- | --- |
| List in Space | `GET` | `/api/companies/:spaceId/goals` |
| Read | `GET` | `/api/goals/:id` |
| Create | `POST` | `/api/companies/:spaceId/goals` |
| Update | `PATCH` | `/api/goals/:id` |
| Delete | `DELETE` | `/api/goals/:id` |

Create example:

```json
{
  "title": "Make agent work easy to inspect",
  "description": "Every result should remain understandable after the session ends.",
  "level": "company",
  "status": "active"
}
```

Internal APIs still call North Stars `goals`. Valid levels are `company`,
`team`, `agent`, and `task`; valid states are `planned`, `active`, `achieved`,
and `cancelled`.

