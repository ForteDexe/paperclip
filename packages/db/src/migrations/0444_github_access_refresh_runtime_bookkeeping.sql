-- A GitHub access refresh (scheduled health checks and continuity renewal)
-- rewrites the grant's access fence, refresh time, and webhook binding debt even
-- when the installation and repository view is unchanged. Those fields are
-- provider bookkeeping, like webhook health and refresh leases, so they must
-- not advance every agent's runtime revision. Repository, installation, and
-- credential changes still do.
CREATE OR REPLACE FUNCTION outpost_connector_runtime_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE space uuid; query text; target record; binding record; candidate uuid;
  old_projection text := '(to_jsonb(o) - $1)'; new_projection text := '(to_jsonb(n) - $1)';
  ignored text[] := ARRAY['updated_at', 'created_at', 'last_used_at', 'last_resolved_at', 'last_health_at',
    'health_status', 'health_checked_at', 'health_message', 'last_catalog_refresh_at', 'last_seen_at', 'last_error', 'last_event_at', 'last_publication_at',
    'last_sync_at', 'sync_checkpoint', 'activation_at', 'lease_token', 'lease_expires_at'];
BEGIN
  IF TG_TABLE_NAME = 'tool_profiles' AND TG_OP = 'INSERT' THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME = 'connection_grant_delegations' THEN
    IF TG_OP = 'INSERT' THEN query := 'SELECT DISTINCT space_id, agent_id FROM new_rows ORDER BY space_id, agent_id';
    ELSIF TG_OP = 'DELETE' THEN query := 'SELECT DISTINCT space_id, agent_id FROM old_rows ORDER BY space_id, agent_id';
    ELSE query := 'WITH changed AS (
      SELECT to_jsonb(o) AS previous, to_jsonb(n) AS current FROM old_rows o FULL JOIN new_rows n ON o.id = n.id
      WHERE (to_jsonb(o) - $1) IS DISTINCT FROM (to_jsonb(n) - $1)), targets AS (
      SELECT previous AS target FROM changed UNION SELECT current FROM changed)
      SELECT DISTINCT (target->>''space_id'')::uuid AS space_id, (target->>''agent_id'')::uuid AS agent_id
      FROM targets WHERE target IS NOT NULL ORDER BY space_id, agent_id';
    END IF;
    FOR binding IN EXECUTE query USING ignored LOOP
      PERFORM outpost_invalidate_connector_agent(binding.space_id, binding.agent_id);
    END LOOP;
    RETURN NULL;
  END IF;
  IF TG_TABLE_NAME = 'space_secret_bindings' THEN
    IF TG_OP = 'INSERT' THEN query := 'SELECT DISTINCT space_id, target_type, target_id FROM new_rows ORDER BY space_id, target_id';
    ELSIF TG_OP = 'DELETE' THEN query := 'SELECT DISTINCT space_id, target_type, target_id FROM old_rows ORDER BY space_id, target_id';
    ELSE query := 'WITH changed AS (
      SELECT to_jsonb(o) AS previous, to_jsonb(n) AS current FROM old_rows o FULL JOIN new_rows n ON o.id = n.id
      WHERE (to_jsonb(o) - $1) IS DISTINCT FROM (to_jsonb(n) - $1)), targets AS (
      SELECT previous AS target FROM changed UNION SELECT current FROM changed)
      SELECT DISTINCT (target->>''space_id'')::uuid AS space_id, target->>''target_type'' AS target_type, target->>''target_id'' AS target_id
      FROM targets WHERE target IS NOT NULL ORDER BY space_id, target_id';
    END IF;
    FOR binding IN EXECUTE query USING ignored LOOP
      IF binding.target_type = 'agent' THEN
        SELECT id INTO candidate FROM agents WHERE space_id = binding.space_id AND id::text = binding.target_id;
        IF FOUND THEN PERFORM outpost_record_agent_runtime(binding.space_id, candidate); END IF;
      ELSE PERFORM outpost_invalidate_connector_space(binding.space_id);
      END IF;
    END LOOP;
    RETURN NULL;
  END IF;
  IF TG_TABLE_NAME = 'connection_grants' THEN
    old_projection := old_projection || ' #- ''{provider_tenant,oauth,refreshLease}'' #- ''{external_credential,lastVerifiedAt}'' #- ''{provider_tenant,github,lastWebhookAt}'' #- ''{provider_tenant,github,webhookHealth}''
      #- ''{provider_tenant,github,accessRevision}'' #- ''{provider_tenant,github,lastAccessRefreshAt}'' #- ''{provider_tenant,github,bindingSync}'' #- ''{provider_tenant,github,continuityRetry}''';
    new_projection := new_projection || ' #- ''{provider_tenant,oauth,refreshLease}'' #- ''{external_credential,lastVerifiedAt}'' #- ''{provider_tenant,github,lastWebhookAt}'' #- ''{provider_tenant,github,webhookHealth}''
      #- ''{provider_tenant,github,accessRevision}'' #- ''{provider_tenant,github,lastAccessRefreshAt}'' #- ''{provider_tenant,github,bindingSync}'' #- ''{provider_tenant,github,continuityRetry}''';
  END IF;
  IF TG_TABLE_NAME = 'tool_policies' THEN
    old_projection := old_projection || ' #- ''{config,trustRule,hitCount}'' #- ''{config,trustRule,lastHitAt}''';
    new_projection := new_projection || ' #- ''{config,trustRule,hitCount}'' #- ''{config,trustRule,lastHitAt}''';
  END IF;
  IF TG_TABLE_NAME IN ('tool_profile_bindings', 'tool_connection_installs', 'tool_profile_entries', 'tool_policies') THEN
    IF TG_TABLE_NAME IN ('tool_profile_entries', 'tool_policies') THEN
      IF TG_OP = 'INSERT' THEN query := 'SELECT to_jsonb(n) AS row_data FROM new_rows n';
      ELSIF TG_OP = 'DELETE' THEN query := 'SELECT to_jsonb(o) AS row_data FROM old_rows o';
      ELSE query := format('WITH changed AS (
        SELECT to_jsonb(o) AS previous, to_jsonb(n) AS current FROM old_rows o FULL JOIN new_rows n ON o.%I = n.%I
        WHERE %s IS DISTINCT FROM %s)
        SELECT previous AS row_data FROM changed WHERE previous IS NOT NULL UNION
        SELECT current AS row_data FROM changed WHERE current IS NOT NULL', TG_ARGV[0], TG_ARGV[0], old_projection, new_projection);
      END IF;
      IF TG_TABLE_NAME = 'tool_profile_entries' THEN
        query := 'SELECT b.space_id, b.target_type, b.target_id FROM (' || query || ') changed
          JOIN tool_profile_bindings b ON b.space_id = (row_data->>''space_id'')::uuid
          AND b.profile_id = (row_data->>''profile_id'')::uuid';
      ELSE
        query := 'SELECT (row_data->>''space_id'')::uuid AS space_id, t.target_type, t.target_id
          FROM (' || query || ') changed CROSS JOIN LATERAL
          outpost_connector_policy_targets((row_data->>''space_id'')::uuid, row_data->''selectors'') t';
      END IF;
    ELSIF TG_OP = 'INSERT' THEN query := 'SELECT space_id, target_type, target_id FROM new_rows';
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
      ORDER BY space_id, target_type DESC, target_id' USING ignored LOOP
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
  ELSE query := format('WITH changed AS (
    SELECT o.space_id AS old_space, n.space_id AS new_space FROM old_rows o FULL JOIN new_rows n ON o.%I = n.%I
    WHERE %s IS DISTINCT FROM %s)
    SELECT old_space AS space_id FROM changed WHERE old_space IS NOT NULL UNION
    SELECT new_space AS space_id FROM changed WHERE new_space IS NOT NULL ORDER BY space_id', TG_ARGV[0], TG_ARGV[0], old_projection, new_projection);
  END IF;
  FOR space IN EXECUTE query USING ignored LOOP
    PERFORM outpost_invalidate_connector_space(space);
  END LOOP;
  RETURN NULL;
END;
$$;
