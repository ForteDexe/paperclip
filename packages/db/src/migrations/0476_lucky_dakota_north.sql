ALTER TABLE "agents" RENAME COLUMN "reports_to" TO "lead_agent_id";--> statement-breakpoint
CREATE OR REPLACE FUNCTION outpost_agent_runtime_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO resource_lifecycle_events(space_id, resource_type, resource_id, action)
      VALUES (OLD.space_id, 'agent_runtime', OLD.id, 'delete');
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND
    jsonb_build_array(OLD.name, OLD.role, OLD.title, OLD.capabilities, OLD.lead_agent_id, OLD.adapter_type, OLD.adapter_config, OLD.runtime_config, OLD.default_environment_id, OLD.permissions, OLD.metadata, OLD.lifecycle_required_plugin_ids)
    IS NOT DISTINCT FROM
    jsonb_build_array(NEW.name, NEW.role, NEW.title, NEW.capabilities, NEW.lead_agent_id, NEW.adapter_type, NEW.adapter_config, NEW.runtime_config, NEW.default_environment_id, NEW.permissions, NEW.metadata, NEW.lifecycle_required_plugin_ids)
    AND NOT (OLD.status = 'pending_approval' AND NEW.status <> 'pending_approval')
    AND NOT (NEW.lifecycle_state = 'ready' AND OLD.lifecycle_state <> 'ready') THEN
    RETURN NEW;
  END IF;
  PERFORM outpost_record_agent_runtime(NEW.space_id, NEW.id);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
ALTER TABLE "agents" DROP CONSTRAINT "agents_reports_to_agents_id_fk";
--> statement-breakpoint
DROP INDEX "agents_space_reports_to_idx";--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_lead_agent_id_agents_id_fk" FOREIGN KEY ("lead_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_space_lead_agent_id_idx" ON "agents" USING btree ("space_id","lead_agent_id");
