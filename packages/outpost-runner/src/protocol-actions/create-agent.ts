/** Canonical definition and documentation for `create_agent`. */
export const createAgentAction = {
  id: "create_agent",
  canonical: {
    operationId: "create_agent",
    surfaces: ["live"],
    placement: "optional_agent_tool",
    optionalGroup: "delegation_dependencies",
    requiredClaims: ["delegation:agents:create"],
    taskModes: ["standard", "skill_test"],
    sideEffectClass: "space_write",
    idempotency: "required",
    disabledByDefault: false,
    realBindingStatus: "live_codex",
    realServiceBinding: "OutpostRunnerToolAuthority",
    orpEvidence: "Authenticated ORP tool input/result and agent-creation state diff with activity record.",
    orpBindingStatus: "bound",
    legacyAliases: [],
  },
  documentation: {
    title: "Create a native agent",
    description: "Create a persistent native Runner teammate with an identity and persona. The caller becomes its coordination lead and the teammate inherits the caller's native runtime; provider, adapter, environment, and credential settings are selected by Outpost and are never caller-supplied here.",
    note: "Use list_agents first when a suitable teammate may already exist.",
  },
  examples: {
    call: {
      operationId: "create_agent",
      input: { name: "Reviewer", role: "qa" },
    },
    success: {
      ok: true,
      operationId: "create_agent",
      result: {},
    },
  },
  live: {
    order: 15,
    descriptor: {
      schema: "outpost.semantic-tool.v1",
      operationId: "create_agent",
      version: 1,
      title: "Create a native agent",
      description: "Create a persistent native Runner teammate with an identity and persona. The caller becomes its coordination lead and the teammate inherits the caller's native runtime; provider, adapter, environment, and credential settings are selected by Outpost and are never caller-supplied here. Reuse a suitable teammate from list_agents when possible.",
      exposure: "optional",
      requiredClaims: ["delegation:agents:create"],
      allowedModes: ["standard", "skill_test"],
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 200 },
          role: { type: "string", enum: ["lead", "engineering_lead", "product", "operations", "security", "engineer", "designer", "pm", "qa", "devops", "researcher", "general"] },
          title: { type: ["string", "null"], maxLength: 300 },
          capabilities: { type: ["string", "null"], maxLength: 2000 },
          instructions: { type: ["string", "null"], maxLength: 20000 },
        },
        required: ["name"],
        additionalProperties: false,
      },
      outputSchema: { type: "object", additionalProperties: true },
    },
  },
  scenario: null,
} as const;
