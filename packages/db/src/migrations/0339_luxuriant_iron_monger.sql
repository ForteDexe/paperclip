ALTER TABLE "space_secrets" DROP CONSTRAINT "space_secrets_scope_shape_check";--> statement-breakpoint
ALTER TABLE "space_secrets" ADD COLUMN "owner_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "space_secrets" ADD COLUMN "owner_plugin_id" uuid;--> statement-breakpoint
ALTER TABLE "space_secrets" ADD CONSTRAINT "space_secrets_owner_plugin_id_plugins_id_fk" FOREIGN KEY ("owner_plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_secrets" ADD CONSTRAINT "space_secrets_space_id_owner_agent_id_agents_space_id_id_fk" FOREIGN KEY ("space_id","owner_agent_id") REFERENCES "public"."agents"("space_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "space_secrets_instance_owner_key_uq" ON "space_secrets" USING btree ("space_id","owner_agent_id","owner_plugin_id","key") WHERE "space_secrets"."scope" = 'instance' and "space_secrets"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "space_secrets" ADD CONSTRAINT "space_secrets_scope_shape_check" CHECK ((
        "space_secrets"."scope" = 'space'
        and "space_secrets"."owner_user_id" is null
        and "space_secrets"."user_secret_definition_id" is null
        and "space_secrets"."owner_agent_id" is null and "space_secrets"."owner_plugin_id" is null
      ) or (
        "space_secrets"."scope" = 'user'
        and "space_secrets"."owner_user_id" is not null
        and "space_secrets"."user_secret_definition_id" is not null
        and "space_secrets"."owner_agent_id" is null and "space_secrets"."owner_plugin_id" is null
      ) or (
        "space_secrets"."scope" = 'instance'
        and "space_secrets"."owner_user_id" is null and "space_secrets"."user_secret_definition_id" is null
        and "space_secrets"."owner_agent_id" is not null and "space_secrets"."owner_plugin_id" is not null
      ));