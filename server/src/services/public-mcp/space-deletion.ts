import {eq,sql} from "drizzle-orm";
import {mcpOauthDeviceRequests as devices,mcpOauthGrants as grants,type Db} from "@outpost/db";
import type {SpaceDeletionParticipant} from "../../lib/space-deletion.js";
import {prepareMcpClientMutation} from "./client-mirror-mutations.js";

export const mcpSpaceDeletion:SpaceDeletionParticipant={async deleteSpaceData(runner,spaceId){
  const tx=runner as unknown as Db;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(736721042)`);
  const [affected]=await tx.select({id:devices.id}).from(devices).innerJoin(grants,eq(devices.grantId,grants.id)).where(eq(grants.spaceId,spaceId)).limit(1);
  if(affected)await prepareMcpClientMutation(tx);
}};
