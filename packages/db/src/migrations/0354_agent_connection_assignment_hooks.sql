CREATE OR REPLACE FUNCTION outpost_record_agent_runtime(p_space uuid, p_agent uuid) RETURNS bigint
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE revision bigint;
BEGIN
  PERFORM 1 FROM agents WHERE space_id = p_space AND id = p_agent
    AND status NOT IN ('pending_approval', 'terminated') FOR NO KEY UPDATE;
  IF FOUND THEN
    INSERT INTO resource_lifecycle_events(space_id, resource_type, resource_id, action)
      VALUES (p_space, 'agent_runtime', p_agent, 'update') RETURNING id INTO revision;
  END IF;
  RETURN revision;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION outpost_invalidate_space_agent_runtimes(p_space uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE candidate uuid;
BEGIN
  FOR candidate IN SELECT id FROM agents WHERE space_id = p_space
    AND status NOT IN ('pending_approval', 'terminated') ORDER BY id FOR NO KEY UPDATE LOOP
    PERFORM outpost_record_agent_runtime(p_space, candidate);
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION outpost_invalidate_skill_source_runtimes(p_space uuid, sources uuid[]) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE candidate uuid;
BEGIN
  FOR candidate IN SELECT a.id FROM agents a WHERE a.space_id = p_space
    AND a.status NOT IN ('pending_approval', 'terminated') AND EXISTS (
      SELECT 1 FROM space_skills s WHERE s.space_id = p_space AND s.access_source_id = ANY(sources)
        AND outpost_agent_selects_runtime_skill(a.adapter_config, a.adapter_type, s.key, s.slug))
    ORDER BY a.id FOR NO KEY UPDATE LOOP
    PERFORM outpost_record_agent_runtime(p_space, candidate);
  END LOOP;
END;
$$;
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
      (a.adapter_type <> 'outpost_runner' AND keys && ARRAY['outpost/outpost/outpost', 'outpost/outpost/complain', 'outpost/outpost/suggestion-box']) OR
      EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a.adapter_config#>'{outpostSkillSync,desiredSkills}') = 'array'
        THEN a.adapter_config#>'{outpostSkillSync,desiredSkills}' ELSE '[]'::jsonb END) choice
        WHERE lower(trim(CASE WHEN jsonb_typeof(choice) = 'string' THEN choice#>>'{}' ELSE choice->>'key' END)) = ANY(keys)))
    ORDER BY a.id FOR NO KEY UPDATE LOOP
    PERFORM outpost_record_agent_runtime(space, candidate);
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION outpost_invalidate_connector_agent(p_space uuid, p_agent uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE setting text := 'outpost.runtime_agent_' || replace(p_agent::text, '-', '_'); xid text := pg_current_xact_id()::text;
BEGIN
  IF current_setting('outpost.runtime_' || replace(p_space::text, '-', '_'), true) IS NOT DISTINCT FROM xid
    OR current_setting(setting, true) IS NOT DISTINCT FROM xid THEN RETURN; END IF;
  PERFORM outpost_record_agent_runtime(p_space, p_agent);
  PERFORM set_config(setting, xid, true);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION outpost_invalidate_connector_space(p_space uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE setting text := 'outpost.runtime_' || replace(p_space::text, '-', '_'); xid text := pg_current_xact_id()::text; candidate uuid;
BEGIN
  IF current_setting(setting, true) IS NOT DISTINCT FROM xid THEN RETURN; END IF;
  FOR candidate IN SELECT id FROM agents WHERE space_id = p_space
    AND status NOT IN ('pending_approval', 'terminated') ORDER BY id FOR NO KEY UPDATE LOOP
    PERFORM outpost_invalidate_connector_agent(p_space, candidate);
  END LOOP;
  PERFORM set_config(setting, xid, true);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION outpost_connector_runtime_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE space uuid; query text; old_projection text; new_projection text; target record; candidate uuid;
BEGIN
  IF TG_TABLE_NAME = 'tool_profiles' AND TG_OP = 'INSERT' THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT 'jsonb_build_array(' || string_agg(format('to_jsonb(o)->%L', field), ',') || ')',
      'jsonb_build_array(' || string_agg(format('to_jsonb(n)->%L', field), ',') || ')'
      INTO old_projection, new_projection FROM unnest(TG_ARGV[1:TG_NARGS - 1]) field;
  END IF;
  IF TG_TABLE_NAME IN ('tool_profile_bindings', 'tool_connection_installs') THEN
    IF TG_OP = 'INSERT' THEN query := 'SELECT space_id, target_type, target_id FROM new_rows';
    ELSIF TG_OP = 'DELETE' THEN query := 'SELECT space_id, target_type, target_id FROM old_rows';
    ELSE query := format('WITH changed AS (
      SELECT o.space_id AS old_space, o.target_type AS old_type, o.target_id AS old_target,
        n.space_id AS new_space, n.target_type AS new_type, n.target_id AS new_target
      FROM old_rows o FULL JOIN new_rows n ON o.%I = n.%I WHERE %s IS DISTINCT FROM %s)
      SELECT old_space AS space_id, old_type AS target_type, old_target AS target_id FROM changed WHERE old_space IS NOT NULL UNION
      SELECT new_space AS space_id, new_type AS target_type, new_target AS target_id FROM changed WHERE new_space IS NOT NULL',
      TG_ARGV[0], TG_ARGV[0], old_projection, new_projection);
    END IF;
    FOR target IN EXECUTE 'SELECT DISTINCT space_id, target_type, target_id FROM (' || query || ') targets
      WHERE target_type IN (''agent'', ''space'')
      ORDER BY space_id, target_type DESC, target_id' LOOP
      IF target.target_type = 'space' AND target.target_id = target.space_id::text THEN
        PERFORM outpost_invalidate_connector_space(target.space_id);
      ELSIF target.target_type = 'agent' AND target.target_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
        SELECT id INTO candidate FROM agents WHERE space_id = target.space_id AND id = target.target_id::uuid;
        IF FOUND THEN PERFORM outpost_invalidate_connector_agent(target.space_id, candidate); END IF;
      END IF;
    END LOOP;
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN query := 'SELECT DISTINCT space_id FROM new_rows ORDER BY space_id';
  ELSIF TG_OP = 'DELETE' THEN query := 'SELECT DISTINCT space_id FROM old_rows ORDER BY space_id';
  ELSE
    query := format('WITH changed AS (
      SELECT o.space_id AS old_space, n.space_id AS new_space FROM old_rows o FULL JOIN new_rows n ON o.%I = n.%I
      WHERE %s IS DISTINCT FROM %s)
      SELECT old_space AS space_id FROM changed WHERE old_space IS NOT NULL UNION
      SELECT new_space AS space_id FROM changed WHERE new_space IS NOT NULL ORDER BY space_id', TG_ARGV[0], TG_ARGV[0], old_projection, new_projection);
  END IF;
  FOR space IN EXECUTE query LOOP
    PERFORM outpost_invalidate_connector_space(space);
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE relation text; arguments text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['tool_connections', 'tool_connection_installs', 'tool_profiles', 'tool_profile_bindings'] LOOP
    arguments := CASE relation
      WHEN 'tool_connections' THEN '''id'', ''space_id'', ''name'', ''transport'', ''enabled'', ''status'''
      WHEN 'tool_connection_installs' THEN '''id'', ''space_id'', ''connection_id'', ''target_type'', ''target_id'''
      WHEN 'tool_profiles' THEN '''id'', ''space_id'', ''status'''
      ELSE '''id'', ''space_id'', ''profile_id'', ''target_type'', ''target_id''' END;
    EXECUTE format('DROP TRIGGER IF EXISTS outpost_connector_runtime_insert ON %I', relation);
    EXECUTE format('DROP TRIGGER IF EXISTS outpost_connector_runtime_update ON %I', relation);
    EXECUTE format('DROP TRIGGER IF EXISTS outpost_connector_runtime_delete ON %I', relation);
    EXECUTE format('CREATE TRIGGER outpost_connector_runtime_insert AFTER INSERT ON %I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION outpost_connector_runtime_changed(%s)', relation, arguments);
    EXECUTE format('CREATE TRIGGER outpost_connector_runtime_update AFTER UPDATE ON %I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION outpost_connector_runtime_changed(%s)', relation, arguments);
    EXECUTE format('CREATE TRIGGER outpost_connector_runtime_delete AFTER DELETE ON %I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION outpost_connector_runtime_changed(%s)', relation, arguments);
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION outpost_connector_flags_runtime_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE space uuid; previous jsonb := coalesce(to_jsonb(OLD)->'experimental', '{}'::jsonb);
  current jsonb := coalesce(to_jsonb(NEW)->'experimental', '{}'::jsonb);
BEGIN
  IF jsonb_build_array(coalesce(previous->'enablePublicMcp', 'false'::jsonb), coalesce(previous->'enableChatConnectors', 'false'::jsonb))
    IS DISTINCT FROM jsonb_build_array(coalesce(current->'enablePublicMcp', 'false'::jsonb), coalesce(current->'enableChatConnectors', 'false'::jsonb)) THEN
    FOR space IN SELECT DISTINCT space_id FROM agents ORDER BY space_id LOOP
      PERFORM outpost_invalidate_connector_space(space);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS outpost_connector_flags_runtime_changed ON instance_settings;
CREATE TRIGGER outpost_connector_flags_runtime_changed AFTER INSERT OR UPDATE OR DELETE ON instance_settings
  FOR EACH ROW EXECUTE FUNCTION outpost_connector_flags_runtime_changed();
