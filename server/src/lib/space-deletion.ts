import type { Db } from "@outpost/db";

type SpaceDeletionTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface SpaceDeletionParticipant {
  // The caller holds the space lock and removes dependent records first.
  // Use this transaction only. Throw on failure. Do not call external systems.
  deleteSpaceData(tx: SpaceDeletionTransaction, spaceId: string): Promise<void>;
}
