DELETE FROM "company_skill_mutation_receipts"
WHERE "key" = 'paperclipai/paperclip/paperclip';
--> statement-breakpoint
UPDATE "company_skills"
SET
  "key" = 'paperclipai/paperclip/outpost-task',
  "slug" = 'outpost-task',
  "name" = 'outpost-task',
  "updated_at" = now()
WHERE "key" = 'paperclipai/paperclip/paperclip'
  AND NOT EXISTS (
    SELECT 1
    FROM "company_skills" AS existing
    WHERE existing."company_id" = "company_skills"."company_id"
      AND existing."key" = 'paperclipai/paperclip/outpost-task'
  );
--> statement-breakpoint
DELETE FROM "company_skills"
WHERE "key" = 'paperclipai/paperclip/paperclip';
--> statement-breakpoint
UPDATE "agents"
SET "adapter_config" = jsonb_set(
  "adapter_config",
  '{paperclipSkillSync,desiredSkills}',
  (
    SELECT jsonb_agg(
      CASE
        WHEN jsonb_typeof(entry.value) = 'string'
          AND lower(trim(entry.value#>>'{}')) IN ('paperclip', 'paperclipai/paperclip/paperclip')
          THEN to_jsonb('paperclipai/paperclip/outpost-task'::text)
        WHEN jsonb_typeof(entry.value) = 'object'
          AND lower(trim(entry.value->>'key')) IN ('paperclip', 'paperclipai/paperclip/paperclip')
          THEN jsonb_set(entry.value, '{key}', to_jsonb('paperclipai/paperclip/outpost-task'::text))
        ELSE entry.value
      END
      ORDER BY entry.ordinality
    )
    FROM jsonb_array_elements("agents"."adapter_config"#>'{paperclipSkillSync,desiredSkills}')
      WITH ORDINALITY AS entry(value, ordinality)
  ),
  false
)
WHERE jsonb_typeof("adapter_config"#>'{paperclipSkillSync,desiredSkills}') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements("adapter_config"#>'{paperclipSkillSync,desiredSkills}') AS entry(value)
    WHERE lower(trim(CASE
      WHEN jsonb_typeof(entry.value) = 'string' THEN entry.value#>>'{}'
      WHEN jsonb_typeof(entry.value) = 'object' THEN entry.value->>'key'
      ELSE ''
    END)) IN ('paperclip', 'paperclipai/paperclip/paperclip')
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION paperclip_skill_runtime_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE previous jsonb; current jsonb; keys text[]; company uuid; candidate uuid;
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
  company := coalesce((current->>'company_id')::uuid, (previous->>'company_id')::uuid);
  SELECT array_agg(DISTINCT lower(reference)) INTO keys FROM (
    SELECT row->>'key' AS reference FROM unnest(ARRAY[previous, current]) row
    UNION ALL SELECT regexp_replace(row->>'key', '.*/', '') FROM unnest(ARRAY[previous, current]) row
    UNION ALL SELECT CASE WHEN row->>'key' LIKE 'paperclipai/paperclip/%' THEN row->>'slug'
      ELSE (row->>'slug') || '--' || left(encode(sha256(convert_to(row->>'key', 'UTF8')), 'hex'), 10) END
      FROM unnest(ARRAY[previous, current]) row
  ) refs WHERE reference IS NOT NULL;
  FOR candidate IN SELECT a.id FROM agents a WHERE a.company_id = company
    AND a.status NOT IN ('pending_approval', 'terminated') AND (
      (a.adapter_type <> 'outpost_runner' AND keys && ARRAY[
        'paperclipai/paperclip/outpost-task',
        'paperclipai/paperclip/outpost-decision',
        'paperclipai/paperclip/outpost-artifact',
        'paperclipai/paperclip/outpost-case',
        'paperclipai/paperclip/outpost-north-star',
        'paperclipai/paperclip/outpost-delegation'
      ]) OR
      EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.adapter_config#>'{paperclipSkillSync,desiredSkills}') = 'array'
        THEN a.adapter_config#>'{paperclipSkillSync,desiredSkills}' ELSE '[]'::jsonb END) choice
        WHERE lower(trim(CASE WHEN jsonb_typeof(choice) = 'string' THEN choice#>>'{}' ELSE choice->>'key' END)) = ANY(keys))
      OR paperclip_environment_selects_runtime_skill(company, a.default_environment_id, coalesce((current->>'id')::uuid, (previous->>'id')::uuid)))
    ORDER BY a.id FOR NO KEY UPDATE LOOP
    PERFORM paperclip_record_agent_runtime(company, candidate);
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
