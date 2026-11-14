import { sql } from "drizzle-orm";
import { toolApplications, toolConnections } from "@outpost/db";

/** Match connection setup's provider identity precedence. Select only this
 * value with a space-scoped connection/application join, never credentials. */
export const toolSourceTemplateKeySql = sql<string | null>`coalesce(
  ${toolConnections.config}->>'sourceTemplateKey',
  ${toolConnections.transportConfig}->>'sourceTemplateKey',
  ${toolApplications.metadata}->>'sourceTemplateKey',
  ${toolApplications.metadata}->>'source'
)`;
