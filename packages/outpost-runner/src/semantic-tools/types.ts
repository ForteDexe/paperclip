import type {
  CapabilityInteractionKind,
  CapabilityJsonValue,
  CapabilityRunContext,
} from "../mock-core/capability-control-plane-types.js";
import type {
  OutpostJsonSchema,
  OutpostJsonValue,
  OutpostSemanticActionDescriptor,
  OutpostSemanticActionEffect,
  OutpostSemanticActionId,
  OutpostSemanticActionMode,
} from "../catalog/semantic-action-types.js";
import type { PrpSemanticToolEnvelope } from "../protocol/replay-contract.js";

export type CapabilitySemanticToolExposure = "always" | "optional";

export type CapabilitySemanticOperationId =
  | "search_api"
  | "call_api"
  | "set_task_title"
  | "send_chat_message"
  | "set_task_monitor"
  | "get_task_context"
  | "get_task_history"
  | "list_documents"
  | "read_document"
  | "list_document_revisions"
  | "report_progress"
  | "answer_status_question"
  | "write_document"
  | "request_human_input"
  | "register_deliverable"
  | "finish_task"
  | "block_task"
  | "request_review"
  | "list_agents"
  | "get_agent"
  | "read_agent_instructions"
  | "update_agent_instructions"
  | "get_agent_instruction_history"
  | "restore_agent_instructions"
  | "search_tasks"
  | "list_approvals"
  | "get_approval"
  | "get_approval_context"
  | "get_workspace_runtime"
  | "control_workspace_service"
  | "reassign_task"
  | "set_dependencies"
  | "create_skill"
  | "update_skill"
  | "get_workspace"
  | "list_workspaces"
  | "select_workspace"
  | "prepare_repository"
  | "create_project"
  | "list_project_repositories"
  | "list_projects"
  | "create_task"
  | "handoff_case"
  | "read_case"
  | "update_case"
  | "create_case"
  | "list_workflows"
  | "read_workflow"
  | "create_workflow"
  | "update_workflow"
  | "request_approval"
  | "decide_approval"
  | "comment_on_approval"
  | "schedule_wake"
  | "submit_complaint"
  | "submit_suggestion"
  | "generic_api_request";

export interface CapabilityJsonSchema {
  readonly $schema?: string;
  readonly type?: string | readonly string[];
  readonly title?: string;
  readonly description?: string;
  readonly properties?: Readonly<Record<string, CapabilityJsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | CapabilityJsonSchema;
  readonly items?: CapabilityJsonSchema;
  readonly enum?: readonly CapabilityJsonValue[];
  readonly const?: CapabilityJsonValue;
  readonly oneOf?: readonly CapabilityJsonSchema[];
  readonly anyOf?: readonly CapabilityJsonSchema[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
  readonly pattern?: string;
  readonly format?: string;
  readonly default?: CapabilityJsonValue;
}

export interface CapabilitySemanticToolDescriptor {
  readonly schema: "outpost.semantic-tool.v1";
  readonly operationId: CapabilitySemanticOperationId;
  readonly version: 1;
  readonly title: string;
  readonly description: string;
  readonly exposure: CapabilitySemanticToolExposure;
  readonly requiredClaims: readonly string[];
  readonly allowedModes: readonly CapabilityRunContext["activeTask"]["workMode"][];
  readonly allowedRoles?: readonly string[];
  readonly disabledByDefault?: boolean;
  readonly inputSchema: CapabilityJsonSchema;
  readonly outputSchema: CapabilityJsonSchema;
}

export interface CapabilitySemanticScenarioPolicy {
  readonly id: string;
  /** Claims that this scenario is permitted to grant. Run claims still narrow this set. */
  readonly claims?: readonly string[];
  readonly allowOperations?: readonly CapabilitySemanticOperationId[];
  readonly denyOperations?: readonly CapabilitySemanticOperationId[];
  readonly allowedInteractionKinds?: readonly CapabilityInteractionKind[];
  readonly enableGenericApiRequest?: boolean;
}

export interface CapabilitySemanticPolicyContext {
  readonly runId: string;
  readonly actor: CapabilityRunContext["actor"];
  readonly task: CapabilityRunContext["activeTask"];
  readonly runClaims: readonly string[];
  readonly explicitClaims: readonly string[];
  readonly scenario: CapabilitySemanticScenarioPolicy;
}

export type CapabilityAuthorizationPhase = "exposure" | "invocation";

export type CapabilitySemanticDenialCode =
  | "tool_not_exposed"
  | "actor_inactive"
  | "task_mode_denied"
  | "task_state_denied"
  | "task_ownership_denied"
  | "required_claim_missing"
  | "actor_role_denied"
  | "scenario_denied"
  | "interaction_kind_denied"
  | "generic_api_disabled"
  | "input_invalid"
  | "protected_data_denied"
  | "operation_unavailable"
  | "control_plane_denied";

export interface CapabilitySemanticAuthorizationDecision {
  readonly allowed: boolean;
  readonly phase: CapabilityAuthorizationPhase;
  readonly operationId: CapabilitySemanticOperationId;
  readonly code: "allowed" | CapabilitySemanticDenialCode;
  readonly reason: string;
  readonly effectiveClaims: readonly string[];
}

export interface CapabilitySemanticAuthorizationRecord
  extends CapabilitySemanticAuthorizationDecision {
  readonly schema: "outpost.semantic-authorization-record.v1";
  readonly id: string;
  readonly runId: string;
  readonly scenarioId: string;
  readonly actorId: string;
  readonly taskId: string;
  readonly callId: string | null;
  readonly input: CapabilityJsonValue | null;
  readonly result: CapabilityJsonValue | null;
}

export interface CapabilitySemanticToolDefinition {
  readonly name: CapabilitySemanticOperationId;
  readonly description: string;
  readonly inputSchema: CapabilityJsonSchema;
  readonly outputSchema: CapabilityJsonSchema;
  readonly annotations: {
    readonly semanticContract: "outpost.semantic-tool.v1";
    readonly operationId: CapabilitySemanticOperationId;
    readonly version: 1;
    readonly exposure: CapabilitySemanticToolExposure;
    readonly requiredClaims: readonly string[];
  };
}

export interface CapabilitySemanticToolCall {
  readonly runId: string;
  readonly callId: string;
  readonly operationId: CapabilitySemanticOperationId | string;
  readonly input: unknown;
}

export interface CapabilitySemanticToolSuccess {
  readonly ok: true;
  readonly operationId: CapabilitySemanticOperationId;
  readonly callId: string;
  readonly result: CapabilityJsonValue;
  readonly stateRevision: number;
}

export interface CapabilitySemanticToolDenial {
  readonly ok: false;
  readonly operationId: string;
  readonly callId: string;
  readonly denial: {
    readonly schema: "outpost.semantic-denial.v1";
    readonly code: CapabilitySemanticDenialCode;
    /** Stable authority error code when the semantic boundary was allowed. */
    readonly controlPlaneCode?: string;
    readonly message: string;
    readonly retryable: boolean;
  };
  readonly stateRevision: number;
}

export type CapabilitySemanticToolResult =
  | CapabilitySemanticToolSuccess
  | CapabilitySemanticToolDenial;

export interface OutpostSemanticRunContext {
  readonly runId: string;
  readonly spaceId: string;
  readonly actor: {
    readonly id: string;
    readonly spaceId: string;
    readonly status: string;
    readonly role: string;
    readonly claims: readonly string[];
  };
  readonly activeTask: {
    readonly id: string;
    readonly spaceId: string;
    readonly assigneeActorId: string | null;
    readonly executionRunId: string | null;
    readonly status: string;
    readonly workMode: OutpostSemanticActionMode;
  };
  /** Claims explicitly delegated to this run. Actor claims can only narrow them. */
  readonly delegatedClaims: readonly string[];
  readonly policy?: {
    readonly deniedOperationIds?: readonly OutpostSemanticActionId[];
    readonly allowedInteractionKinds?: readonly string[];
  };
}

export type OutpostSemanticContextProvider = (
  runId: string,
) => OutpostSemanticRunContext | Promise<OutpostSemanticRunContext>;

export interface OutpostSemanticToolDefinition {
  readonly name: OutpostSemanticActionId;
  readonly description: string;
  readonly inputSchema: OutpostJsonSchema;
  readonly outputSchema: OutpostJsonSchema;
  readonly annotations: {
    readonly semanticContract: "outpost.semantic-action.v1";
    readonly version: 1;
    readonly placement: OutpostSemanticActionDescriptor["placement"];
    readonly effect: OutpostSemanticActionEffect;
    readonly requiredClaims: readonly string[];
  };
}

export interface OutpostSemanticDiscoveryResult {
  readonly schema: "outpost.semantic-discovery.v1";
  readonly query: string;
  readonly namespace: string | null;
  readonly operations: readonly OutpostSemanticToolDefinition[];
  readonly truncated: boolean;
}

export type OutpostSemanticAuthorizationPhase = "exposure" | "invocation";

export type OutpostSemanticDenialCode =
  | "operation_absent"
  | "authority_context_invalid"
  | "run_mismatch"
  | "space_mismatch"
  | "actor_inactive"
  | "task_mode_denied"
  | "task_state_denied"
  | "task_ownership_denied"
  | "required_claim_missing"
  | "actor_role_denied"
  | "policy_denied"
  | "interaction_kind_denied"
  | "protected_data_denied"
  | "input_invalid"
  | "idempotency_required"
  | "idempotency_conflict"
  | "idempotency_in_progress"
  | "receipt_store_unavailable"
  | "receipt_recovery_failed"
  | "binding_failed"
  | "binding_output_invalid";

export interface OutpostSemanticAuthorizationDecision {
  readonly allowed: boolean;
  readonly phase: OutpostSemanticAuthorizationPhase;
  readonly operationId: OutpostSemanticActionId;
  readonly code: "allowed" | OutpostSemanticDenialCode;
  readonly reason: string;
  readonly effectiveClaims: readonly string[];
}

export interface OutpostSemanticAuthorizationRecord extends OutpostSemanticAuthorizationDecision {
  readonly schema: "outpost.semantic-authorization-record.v1";
  readonly id: string;
  readonly runId: string;
  readonly spaceId: string;
  readonly actorId: string;
  readonly taskId: string;
  readonly callId: string | null;
  readonly inputDigest: string | null;
  readonly operationReceiptId: string | null;
}

export interface OutpostSemanticSafeReference {
  readonly kind:
    | "task"
    | "document_revision"
    | "interaction"
    | "approval"
    | "decision"
    | "artifact"
    | "work_product"
    | "wake"
    | "monitor"
    | "audit"
    | "operation";
  readonly id: string;
}

export interface OutpostSemanticBindingResult {
  readonly value: OutpostJsonValue;
  readonly code?: string;
  readonly stateRevision?: number;
  readonly references?: readonly OutpostSemanticSafeReference[];
  readonly auditReceiptId?: string;
}

export interface OutpostAuthorizedSemanticInvocation {
  readonly runId: string;
  readonly spaceId: string;
  readonly actorId: string;
  readonly taskId: string;
  readonly callId: string;
  readonly operationId: OutpostSemanticActionId;
  readonly input: Readonly<Record<string, OutpostJsonValue>>;
}

export interface OutpostSemanticActionBinding {
  readonly operationId: OutpostSemanticActionId;
  execute(
    invocation: OutpostAuthorizedSemanticInvocation,
  ): OutpostSemanticBindingResult | Promise<OutpostSemanticBindingResult>;
}

export interface OutpostSemanticCorrelation {
  readonly runId: string;
  readonly normalizedSessionId: string;
  readonly turnId: string;
  readonly itemId: string;
  readonly requestId?: string;
}

export interface OutpostSemanticToolCall {
  readonly runId: string;
  readonly callId: string;
  readonly operationId: string;
  readonly correlation: OutpostSemanticCorrelation;
  readonly input: unknown;
}

export interface OutpostSemanticStoredOutcome {
  readonly operationId: OutpostSemanticActionId;
  readonly inputDigest: string;
  readonly operationReceiptId: string;
  readonly value: OutpostJsonValue;
  readonly code: string;
  readonly stateRevision?: number;
  readonly references: readonly OutpostSemanticSafeReference[];
  readonly auditReceiptId?: string;
}

export type OutpostSemanticIdempotencyClaim =
  | { readonly kind: "claimed"; readonly token: string }
  | {
      readonly kind: "duplicate";
      readonly outcome: OutpostSemanticStoredOutcome;
    }
  | { readonly kind: "conflict" }
  | { readonly kind: "in_progress" };

/**
 * The claim operation must be atomic. Production bindings must persist this
 * store before they expose mutation actions. `complete` is the primary commit
 * path. `recover` is a required, idempotent fallback that must durably resolve
 * a claim to the same outcome when the primary commit reports an ambiguous or
 * transient failure. A store without an independent recovery path cannot be
 * used to expose mutation actions.
 */
export interface OutpostSemanticIdempotencyStore {
  claim(input: {
    readonly scope: string;
    readonly operationId: OutpostSemanticActionId;
    readonly inputDigest: string;
  }):
    | OutpostSemanticIdempotencyClaim
    | Promise<OutpostSemanticIdempotencyClaim>;
  complete(
    token: string,
    outcome: OutpostSemanticStoredOutcome,
  ): void | Promise<void>;
  recover(
    token: string,
    outcome: OutpostSemanticStoredOutcome,
  ): void | Promise<void>;
  release(token: string): void | Promise<void>;
}

export interface OutpostSemanticToolSuccess {
  readonly ok: true;
  readonly operationId: OutpostSemanticActionId;
  readonly callId: string;
  readonly value: OutpostJsonValue;
  readonly code: string;
  readonly duplicate: boolean;
  readonly stateRevision?: number;
  readonly inputReceipt: PrpSemanticToolEnvelope;
  readonly resultReceipt: PrpSemanticToolEnvelope;
}

export interface OutpostSemanticToolDenial {
  readonly ok: false;
  readonly operationId: string;
  readonly callId: string;
  readonly error: {
    readonly code: OutpostSemanticDenialCode;
    readonly message: string;
    readonly retryable: boolean;
  };
  readonly inputReceipt: PrpSemanticToolEnvelope | null;
  readonly resultReceipt: PrpSemanticToolEnvelope | null;
}

export type OutpostSemanticToolResult =
  OutpostSemanticToolSuccess | OutpostSemanticToolDenial;
