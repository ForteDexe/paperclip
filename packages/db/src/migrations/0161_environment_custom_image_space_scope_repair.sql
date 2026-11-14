-- No-op retained for migration ordering compatibility.
--
-- This branch previously carried a space-scope repair for environment custom
-- images, but origin/master intentionally restored custom images to the
-- instance-scoped environment model in 0127. Reapplying space scope here
-- contradicts the checked-in Drizzle schema and can fail against cloned
-- multi-space dev databases.
SELECT 1;
