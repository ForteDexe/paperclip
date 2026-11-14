import { assertVoiceInboundCleanupSettled } from "../voice/voice-inbound-cleanup.js";
import { chatEndpoints } from "@outpost/db";
import { eq } from "drizzle-orm";
import type { SpaceDeletionParticipant } from "../../lib/space-deletion.js";

export const chatSpaceDeletion: SpaceDeletionParticipant = {
  async deleteSpaceData(tx, spaceId) {
    // Ingress locks the endpoint before admitting a provider call. Hold that
    // lock through the cleanup proof and delete so a new call cannot slip in.
    await tx.select({ id: chatEndpoints.id }).from(chatEndpoints).where(eq(chatEndpoints.spaceId, spaceId)).for("update");
    await assertVoiceInboundCleanupSettled(tx, spaceId);
    await tx.delete(chatEndpoints).where(eq(chatEndpoints.spaceId, spaceId));
  },
};
