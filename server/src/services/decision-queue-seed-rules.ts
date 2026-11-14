import { and, eq, type SQLWrapper } from "drizzle-orm";
import { issueWorkProducts } from "@outpost/db";

export function pullRequestSeedProductCondition(spaceId: string | SQLWrapper) {
  return and(eq(issueWorkProducts.spaceId, spaceId), eq(issueWorkProducts.type, "pull_request"));
}
