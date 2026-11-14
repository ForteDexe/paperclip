DELETE FROM "space_skill_mutation_receipts"
WHERE "key" = 'outpost/outpost/outpost';
--> statement-breakpoint
UPDATE "space_skills"
SET
  "key" = 'outpost/outpost/outpost-task',
  "slug" = 'outpost-task',
  "name" = 'outpost-task',
  "updated_at" = now()
WHERE "key" = 'outpost/outpost/outpost'
  AND NOT EXISTS (
    SELECT 1
    FROM "space_skills" AS existing
    WHERE existing."space_id" = "space_skills"."space_id"
      AND existing."key" = 'outpost/outpost/outpost-task'
  );
--> statement-breakpoint
DELETE FROM "space_skills"
WHERE "key" = 'outpost/outpost/outpost';
--> statement-breakpoint
UPDATE "agents"
SET "adapter_config" = jsonb_set(
  "adapter_config",
  '{outpostSkillSync,desiredSkills}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN jsonb_typeof(entry.value) = 'string'
          AND lower(trim(entry.value#>>'{}')) IN ('outpost', 'outpost/outpost/outpost')
          THEN to_jsonb('outpost/outpost/outpost-task'::text)
        WHEN jsonb_typeof(entry.value) = 'object'
          AND lower(trim(entry.value->>'key')) IN ('outpost', 'outpost/outpost/outpost')
          THEN jsonb_set(entry.value, '{key}', to_jsonb('outpost/outpost/outpost-task'::text))
        ELSE entry.value
      END
      ORDER BY entry.ordinality
    )
    FROM jsonb_array_elements("agents"."adapter_config"#>'{outpostSkillSync,desiredSkills}')
      WITH ORDINALITY AS entry(value, ordinality)
  ),
  false
)
WHERE jsonb_typeof("adapter_config"#>'{outpostSkillSync,desiredSkills}') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements("adapter_config"#>'{outpostSkillSync,desiredSkills}') AS entry(value)
    WHERE lower(trim(CASE
      WHEN jsonb_typeof(entry.value) = 'string' THEN entry.value#>>'{}'
      WHEN jsonb_typeof(entry.value) = 'object' THEN entry.value->>'key'
      ELSE ''
    END)) IN ('outpost', 'outpost/outpost/outpost')
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION outpost_skill_runtime_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE previous jsonb; current jsonb; keys text[]; space uuid; candidate uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN previous := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN current := to_jsonb(NEW); END IF;
  IF TG_OP = 'UPDATE' AND
    jsonb_build_array(OLD.key, OLD.slug, OLD.markdown, OLD.source_type, OLD.source_locator, OLD.source_ref,
      OLD.file_inventory, OLD.current_version_id, OLD.access_source_id, OLD.compatibility, OLD.trust_level, OLD.metadata)
    IS NOT DISTINCT FROM
    jsonb_build_array(NEW.key, NEW.slug, NEW.markdown, NEW.source_type, NEW.source_locator, NEW.source_ref,
      NEW.file_inventory, NEW.current_version_id, NEW.access_source_id, NEW.compatibility, NEW.trust_level, NEW.metadata)
    THEN RETURN NEW; END IF;
  space := coalesce((current->>'space_id')::uuid, (previous->>'space_id')::uuid);
  SELECT array_agg(DISTINCT lower(reference)) INTO keys FROM (
    SELECT row->>'key' AS reference FROM unnest(ARRAY[previous, current]) row
    UNION ALL SELECT regexp_replace(row->>'key', '.*/', '') FROM unnest(ARRAY[previous, current]) row
    UNION ALL SELECT CASE WHEN row->>'key' LIKE 'outpost/outpost/%' THEN row->>'slug'
      ELSE (row->>'slug') || '--' || left(encode(sha256(convert_to(row->>'key', 'UTF8')), 'hex'), 10) END
      FROM unnest(ARRAY[previous, current]) row
  ) refs WHERE reference IS NOT NULL;
  FOR candidate IN SELECT a.id FROM agents a WHERE a.space_id = space
    AND a.status NOT IN ('pending_approval', 'terminated') AND (
      (a.adapter_type <> 'outpost_runner' AND keys && ARRAY[
        'outpost/outpost/outpost-task',
        'outpost/outpost/outpost-decision',
        'outpost/outpost/outpost-artifact',
        'outpost/outpost/outpost-case',
        'outpost/outpost/outpost-north-star',
        'outpost/outpost/outpost-delegation'
      ]) OR
      EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.adapter_config#>'{outpostSkillSync,desiredSkills}') = 'array'
        THEN a.adapter_config#>'{outpostSkillSync,desiredSkills}' ELSE '[]'::jsonb END) choice
        WHERE lower(trim(CASE WHEN jsonb_typeof(choice) = 'string' THEN choice#>>'{}' ELSE choice->>'key' END)) = ANY(keys))
      OR outpost_environment_selects_runtime_skill(space, a.default_environment_id, coalesce((current->>'id')::uuid, (previous->>'id')::uuid)))
    ORDER BY a.id FOR NO KEY UPDATE LOOP
    PERFORM outpost_record_agent_runtime(space, candidate);
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
