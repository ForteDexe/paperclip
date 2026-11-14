import type { LifecycleFailure } from "../application/ports.js";
import type { Db } from "@outpost/db";
import type { budgetPolicies } from "@outpost/db";
import type { CreateAgentData, CreateAgentOptions, AgentConfigurationPatch, AgentConfigurationRecord, AgentCreationRecord, UpdateAgentOptions } from "../../../lib/agent-records.js";
import type { ActivityPublication } from "../../../types/activity-publication.js";

/** Services supply integrations; lifecycle owns the transaction and state writes. */
export interface LifecycleEffects {
  setupRequiresPreparation(db: Db, spaceId: string, environmentId: string | null | undefined,
    profile: Pick<CreateAgentData, "adapterType" | "adapterConfig">): Promise<boolean>;
  environmentRequiresNewPlugin(db: Db, environmentId: string | null | undefined, selectedPluginIds: string[] | null): Promise<boolean>;
  notifyWork(db: Db): Promise<void>;
  /** The calling controller process, stamped on a lifecycle lease so restart recovery can settle a dead holder. */
  leaseHolder?(): Record<string, unknown> | null;
  beforeStatusChange(db: Db, spaceId: string, agentId: string, before: string, after: string): Promise<void>;
  beforeConnectionEligibilityRestore?(db: Db, spaceId: string, agentId: string): Promise<void>;
  reportFailure(context: LifecycleFailure, error: unknown): void;
  deleteDependencies(db: Db, spaceId: string, agentId: string): Promise<void>;
  lockConfigurationInteractions(db: Db, id: string, data: AgentConfigurationPatch, options?: UpdateAgentOptions): Promise<UpdateAgentOptions | undefined>;
  prepareConfiguration(db: Db, current: AgentConfigurationRecord, data: AgentConfigurationPatch, options?: UpdateAgentOptions): Promise<AgentConfigurationPatch>;
  completeConfiguration(db: Db, before: AgentConfigurationRecord, after: AgentConfigurationRecord, patch: AgentConfigurationPatch, options: UpdateAgentOptions | undefined, publications: ActivityPublication[]): Promise<void>;
  transaction<T>(db: Db, spaceId: string, work: (tx: Db, publications: ActivityPublication[]) => Promise<T>): Promise<T>;
  policyBlocks(db: Db, policy: typeof budgetPolicies.$inferSelect): Promise<boolean>;
  setAgentBudget(db: Db, publications: ActivityPublication[], spaceId: string, agentId: string, amount: number, userId: string | null, isActive?: boolean): Promise<unknown>;
  recordCreation(db: Db, spaceId: string, agentId: string): Promise<void>;
  recordStatus(db: Db, spaceId: string, agentId: string, before: string, after: string): Promise<void>;
  clearPrimary(db: Db, spaceId: string, agentId: string): Promise<unknown>;
  prepareCreate(db: Db, spaceId: string, data: CreateAgentData, options?: CreateAgentOptions): Promise<CreateAgentData>;
  initializeCreate(db: Db, agent: AgentCreationRecord, options?: CreateAgentOptions): Promise<void>;
  prepareCreationApproval(db: Db, agent: AgentCreationRecord, payload?: Record<string, unknown> | null): Promise<AgentConfigurationPatch>;
  completeCreationApproval(db: Db, agent: AgentCreationRecord, previous: AgentCreationRecord): Promise<void>;
}
