import { and, eq, sql } from "drizzle-orm";
import {
  chatEndpoints,
  chatExternalPrincipals,
  chatGitHubConfigurations,
  chatIdentityLinks,
  spaceMemberships,
  type Db,
} from "@outpost/db";

type Database = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Current authority shared by task admission and every later publication. */
export async function githubChatPrincipalAccess(
  db: Database,
  endpoint: Pick<typeof chatEndpoints.$inferSelect, "id" | "spaceId" | "provider" | "allowUnlinkedPeople">,
  principalId: string,
) {
  if (endpoint.provider !== "github") return null;
  const [saved] = await db
    .select({ configuration: sql<Pick<typeof chatGitHubConfigurations.$inferSelect["configuration"], "people" | "memberAccess">>`jsonb_build_object(
      'people', ${chatGitHubConfigurations.configuration}->'people',
      'memberAccess', ${chatGitHubConfigurations.configuration}->'memberAccess'
    )` })
    .from(chatGitHubConfigurations)
    .where(
      and(
        eq(chatGitHubConfigurations.spaceId, endpoint.spaceId),
        eq(chatGitHubConfigurations.endpointId, endpoint.id),
      ),
    )
    .for("share");
  if (!saved) return null; // Preserve the existing connector until explicitly upgraded.
  const [principal] = await db
    .select({ externalId: chatExternalPrincipals.externalId })
    .from(chatExternalPrincipals)
    .where(
      and(
        eq(chatExternalPrincipals.spaceId, endpoint.spaceId),
        eq(chatExternalPrincipals.id, principalId),
      ),
    )
    .for("share");
  const denied = {
    allowed: false,
    linkedDenied: true,
    userId: null as string | null,
    sponsorUserId: null as string | null,
  };
  if (!principal) return denied;
  const config = saved.configuration;
  const person = config.people.find(
    (p) => p.githubUserId === principal.externalId,
  );
  const [link] = await db
    .select({ status: chatIdentityLinks.status, outpostUserId: chatIdentityLinks.outpostUserId })
    .from(chatIdentityLinks)
    .where(
      and(
        eq(chatIdentityLinks.spaceId, endpoint.spaceId),
        eq(chatIdentityLinks.endpointId, endpoint.id),
        eq(chatIdentityLinks.principalId, principalId),
      ),
    )
    .for("share");
  const activeMember = async (userId: string) => {
    const [membership] = await db
      .select({ membershipRole: spaceMemberships.membershipRole })
      .from(spaceMemberships)
      .where(
        and(
          eq(spaceMemberships.spaceId, endpoint.spaceId),
          eq(spaceMemberships.principalType, "user"),
          eq(spaceMemberships.principalId, userId),
          eq(spaceMemberships.status, "active"),
        ),
      )
      .for("share");
    return !!membership && membership.membershipRole !== "viewer";
  };
  if (link?.status === "linked" && link.outpostUserId) {
    const allowed =
      (await activeMember(link.outpostUserId)) &&
      (config.memberAccess === "all_linked" ||
        (person?.kind === "member" && person.userId === link.outpostUserId));
    return {
      ...denied,
      allowed,
      linkedDenied: !allowed,
      userId: allowed ? link.outpostUserId : null,
    };
  }
  // Revocation is not an invitation to fall back to a guest identity.
  if (
    link?.status === "revoked" ||
    person?.kind !== "guest" ||
    !endpoint.allowUnlinkedPeople ||
    !(await activeMember(person.sponsorUserId))
  )
    return denied;
  return {
    allowed: true,
    linkedDenied: false,
    userId: null,
    sponsorUserId: person.sponsorUserId,
  };
}
