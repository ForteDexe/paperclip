/** Canonical definition and documentation for `list_approvals`. */
export const listApprovalsAction = {
  "id": "list_approvals",
  "canonical": {
    "operationId": "list_approvals",
    "surfaces": [
      "scenario",
      "live"
    ],
    "placement": "optional_agent_tool",
    "optionalGroup": "approvals",
    "requiredClaims": [
      "approvals:approvals:read"
    ],
    "taskModes": [
      "standard",
      "ask",
      "planning",
      "skill_test"
    ],
    "sideEffectClass": "read",
    "idempotency": "none",
    "disabledByDefault": false,
    "realBindingStatus": "live_codex",
    "realServiceBinding": "unbound",
    "orpEvidence": "read projection surfaced via a tool-result item event; no control-plane state diff",
    "orpBindingStatus": "audit_pending",
    "legacyAliases": []
  },
  "documentation": {
    "title": "List approvals",
    "description": "List approvals in the run space.",
    "note": null
  },
  "examples": {
    "call": {
      "operationId": "list_approvals",
      "input": {}
    },
    "success": {
      "ok": true,
      "operationId": "list_approvals",
      "result": {}
    }
  },
  "live": {
    "order": 16,
    "descriptor": {
      "schema": "outpost.semantic-tool.v1",
      "operationId": "list_approvals",
      "version": 1,
      "title": "List approvals",
      "description": "List approvals in the run space.",
      "exposure": "optional",
      "requiredClaims": [
        "approvals:approvals:read"
      ],
      "allowedModes": [
        "standard",
        "ask",
        "planning",
        "skill_test"
      ],
      "inputSchema": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false
      },
      "outputSchema": {
        "type": "object",
        "additionalProperties": true
      }
    }
  },
  "scenario": {
    "order": 20,
    "descriptor": {
      "operationId": "list_approvals",
      "version": 1,
      "title": "List Approvals",
      "description": "List Approvals through the Capability approvals capability set.",
      "inputSchema": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "schema": {
            "type": "string",
            "enum": [
              "outpost.capability.tool-result.v1"
            ]
          },
          "ok": {
            "type": "boolean"
          },
          "operationId": {
            "const": "list_approvals"
          },
          "operationResultId": {
            "type": "string",
            "minLength": 1
          },
          "value": {},
          "commandResult": {},
          "authorization": {}
        },
        "required": [
          "schema",
          "ok",
          "operationId",
          "operationResultId",
          "value",
          "commandResult",
          "authorization"
        ],
        "additionalProperties": false
      },
      "disposition": "optional_agent_tool",
      "optionalGroup": "approvals",
      "requiredClaims": [
        "approvals:approvals:read"
      ],
      "taskModes": [
        "standard",
        "ask",
        "planning",
        "skill_test"
      ],
      "sideEffectClass": "read",
      "idempotency": "none",
      "redaction": [],
      "mockCommandMapping": {
        "kind": "snapshot_read",
        "projection": "space_approvals"
      }
    }
  }
} as const;
