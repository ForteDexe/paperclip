import { z } from "zod";

export interface DefaultAgentPreference {
  spaceId: string;
  userId: string;
  defaultAgentId: string | null;
  initialized: boolean;
}

export const updateDefaultAgentSchema = z.object({
  defaultAgentId: z.string().uuid(),
}).strict();

export type UpdateDefaultAgent = z.infer<typeof updateDefaultAgentSchema>;
