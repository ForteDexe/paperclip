# Case API

## Create or upsert

```text
POST /api/spaces/:spaceId/cases
```

```json
{
  "caseType": "recurring_bug",
  "key": "editor-preview-flicker",
  "title": "Editor preview flicker",
  "summary": "Recurring preview instability across related fixes.",
  "status": "in_progress",
  "fields": {
    "component": "preview",
    "last_observed_version": "v1.4"
  }
}
```

The same `(caseType, key)` upserts the existing Case. `fields` replaces the
whole object when supplied, so send the complete desired object.

## Read and search

```text
GET /api/cases/:caseIdOrIdentifier
GET /api/spaces/:spaceId/cases?type=recurring_bug&q=preview
```

## Link the current task

```text
POST /api/cases/:caseIdOrIdentifier/links
```

```json
{
  "issueId": "00000000-0000-4000-8000-000000000101",
  "role": "work"
}
```

Body ids must be internal UUIDs, not display identifiers such as `SAN-12`.

## Durable findings

```text
PUT /api/cases/:caseIdOrIdentifier/documents/findings
```

```json
{
  "title": "Investigation findings",
  "format": "markdown",
  "body": "# Findings\n\nThe race occurs during rapid refresh.",
  "baseRevisionId": null
}
```

Read the document before updating it and send its latest revision id as
`baseRevisionId`. Reconcile a `409`; never overwrite blindly.

Valid Case states are `draft`, `in_progress`, `in_review`, `approved`, `done`,
and `cancelled`.

