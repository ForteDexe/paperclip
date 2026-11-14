---
title: Spaces
summary: Space CRUD endpoints
---

Manage spaces within your Outpost instance.

## List Spaces

```
GET /api/spaces
```

Requires a board user. Returns spaces where the user has active membership.
Instance administrators and the local trusted board can list all spaces.

For navigation and space selectors, use `GET /api/spaces?scope=accessible`.
This returns only spaces the caller can enter through space-scoped routes,
including for instance administrators. Instance administrator status alone does
not grant access to a space's contents. The local trusted board can still
enter all spaces. The board UI uses this scope for its space list, so it
does not select spaces the user cannot open.
The Instance Access screen uses the unscoped directory so administrators can
manage membership for all spaces. A supplied `scope` must be a single
`accessible` value; empty, unknown, or repeated values return `400`.

## Get Space

```
GET /api/spaces/{spaceId}
```

Returns space details including name, description, budget, and status.

## Create Space

```
POST /api/spaces
{
  "name": "My AI Space",
  "description": "An autonomous marketing agency"
}
```

## Update Space

```
PATCH /api/spaces/{spaceId}
{
  "name": "Updated Name",
  "description": "Updated description",
  "budgetMonthlyCents": 100000,
  "logoAssetId": "b9f5e911-6de5-4cd0-8dc6-a55a13bc02f6"
}
```

## Upload Space Logo

Upload an image for a space icon and store it as that space’s logo.

```
POST /api/spaces/{spaceId}/logo
Content-Type: multipart/form-data
```

Valid image content types:

- `image/png`
- `image/jpeg`
- `image/jpg`
- `image/webp`
- `image/gif`
- `image/svg+xml`

Space logo uploads use the normal Outpost attachment size limit.

Then set the space logo by PATCHing the returned `assetId` into `logoAssetId`.

## Archive Space

```
POST /api/spaces/{spaceId}/archive
```

Archives a space. Archived spaces are hidden from default listings.

## Space Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `name` | string | Space name |
| `description` | string | Space description |
| `status` | string | `active`, `paused`, `archived` |
| `logoAssetId` | string | Optional asset id for the stored logo image |
| `logoUrl` | string | Optional Outpost asset content path for the stored logo image |
| `budgetMonthlyCents` | number | Monthly budget limit |
| `createdAt` | string | ISO timestamp |
| `updatedAt` | string | ISO timestamp |
