import { executionAdmissions } from "@outpost/db";
import { eq } from "drizzle-orm";
import type { SpaceDeletionParticipant } from "../../../lib/space-deletion.js";

/** Removes every admission, settled or not, before the space's runs and projects are deleted. */
export const executionAdmissionSpaceDeletion: SpaceDeletionParticipant = {
  async deleteSpaceData(tx, spaceId) {
    if (!("nestedIndex" in tx)) throw new Error("Outpost deletion requires a database transaction");
    await tx.delete(executionAdmissions).where(eq(executionAdmissions.spaceId, spaceId));
  },
};
