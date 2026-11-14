import { z } from "zod";

export interface PrimaryAgentPreference {
  spaceId: string;
  userId: string;
  primaryAgentId: string | null;
  initialized: boolean;
}

export const updatePrimaryAgentSchema = z.object({
  primaryAgentId: z.string().uuid(),
}).strict();

export type UpdatePrimaryAgent = z.infer<typeof updatePrimaryAgentSchema>;
