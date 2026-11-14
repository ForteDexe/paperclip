export type OutpostSemanticActionId =
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
  | "create_agent"
  | "get_agent"
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
  | "schedule_wake";

export type OutpostSemanticActionPlacement = "always" | "optional";
export type OutpostSemanticActionMode =
  "standard" | "ask" | "planning" | "skill_test";
export type OutpostSemanticActionEffect = "read" | "write" | "approvals";

export type OutpostJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly OutpostJsonValue[]
  | { readonly [key: string]: OutpostJsonValue };

/** The JSON Schema subset used by the v1 semantic action catalog. */
export interface OutpostJsonSchema {
  readonly type?: string | readonly string[];
  readonly title?: string;
  readonly description?: string;
  readonly properties?: Readonly<Record<string, OutpostJsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | OutpostJsonSchema;
  readonly items?: OutpostJsonSchema;
  readonly enum?: readonly OutpostJsonValue[];
  readonly const?: OutpostJsonValue;
  readonly oneOf?: readonly OutpostJsonSchema[];
  readonly anyOf?: readonly OutpostJsonSchema[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
  readonly pattern?: string;
  readonly format?: string;
  readonly default?: OutpostJsonValue;
}

/**
 * A transport-neutral declaration. Catalog membership never grants discovery
 * or invocation authority; a run-scoped authorization layer must do that.
 */
export interface OutpostSemanticActionDescriptor {
  readonly schema: "outpost.semantic-action.v1";
  readonly operationId: OutpostSemanticActionId;
  readonly version: 1;
  readonly title: string;
  readonly description: string;
  readonly placement: OutpostSemanticActionPlacement;
  readonly effect: OutpostSemanticActionEffect;
  readonly requiredClaims: readonly string[];
  readonly allowedModes: readonly OutpostSemanticActionMode[];
  readonly allowedRoles?: readonly string[];
  readonly inputSchema: OutpostJsonSchema;
  readonly outputSchema: OutpostJsonSchema;
}
