INSERT INTO "principal_permission_grants" (
  "space_id",
  "principal_type",
  "principal_id",
  "permission_key",
  "scope",
  "granted_by_user_id"
)
SELECT
  "space_id",
  'user',
  "principal_id",
  'commentary:view',
  NULL,
  NULL
FROM "space_memberships"
WHERE "principal_type" = 'user'
  AND "status" = 'active'
ON CONFLICT (
  "space_id",
  "principal_type",
  "principal_id",
  "permission_key"
) DO NOTHING;
