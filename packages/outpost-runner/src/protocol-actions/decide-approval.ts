/** Canonical definition and documentation for `decide_approval`. */
export const decideApprovalAction = {
  "id": "decide_approval",
  "canonical": {
    "operationId": "decide_approval",
    "surfaces": [
      "scenario",
      "live"
    ],
    "placement": "optional_agent_tool",
    "optionalGroup": "approvals",
    "requiredClaims": [
      "approvals:approvals:decide"
    ],
    "taskModes": [
      "standard",
      "skill_test"
    ],
    "allowedRoles": [
      "operator",
      "approver",
      "security"
    ],
    "sideEffectClass": "approvals",
    "idempotency": "required",
    "disabledByDefault": false,
    "realBindingStatus": "live_codex",
    "realServiceBinding": "unbound",
    "orpEvidence": "approval lifecycle plus controlled-wait continuation and audit events",
    "orpBindingStatus": "audit_pending",
    "legacyAliases": []
  },
  "documentation": {
    "title": "Decide approval",
    "description": "Decide an approval as an explicitly authorized approver.",
    "note": null
  },
  "examples": {
    "call": {
      "operationId": "decide_approval",
      "input": {
        "idempotencyKey": "example",
        "approvalId": "example",
        "decision": "approved",
        "note": "example"
      }
    },
    "scenarioCall": {
      "operationId": "decide_approval",
      "idempotencyKey": "example",
      "input": {
        "approvalId": "example",
        "decision": "approved",
        "note": "example"
      }
    },
    "success": {
      "ok": true,
      "operationId": "decide_approval",
      "result": {
        "commandId": "example",
        "disposition": "applied",
        "stateRevision": 1,
        "entityRefs": [
          "example"
        ],
        "scheduledWakeIds": [
          "example"
        ]
      }
    }
  },
  "live": {
    "order": 24,
    "descriptor": {
      "schema": "outpost.semantic-tool.v1",
      "operationId": "decide_approval",
      "version": 1,
      "title": "Decide approval",
      "description": "Decide an approval as an explicitly authorized approver.",
      "exposure": "optional",
      "requiredClaims": [
        "approvals:approvals:decide"
      ],
      "allowedModes": [
        "standard",
        "skill_test"
      ],
      "allowedRoles": [
        "operator",
        "approver",
        "security"
      ],
      "inputSchema": {
        "type": "object",
        "properties": {
          "idempotencyKey": {
            "type": "string",
            "description": "Caller-stable retry key.",
            "minLength": 1,
            "maxLength": 240
          },
          "approvalId": {
            "type": "string",
            "description": "Approval id.",
            "minLength": 1,
            "maxLength": 200
          },
          "decision": {
            "enum": [
              "approved",
              "rejected",
              "cancelled"
            ]
          },
          "note": {
            "type": "string",
            "description": "Decision note.",
            "minLength": 1,
            "maxLength": 20000
          }
        },
        "required": [
          "idempotencyKey",
          "approvalId",
          "decision",
          "note"
        ],
        "additionalProperties": false
      },
      "outputSchema": {
        "type": "object",
        "properties": {
          "commandId": {
            "type": "string",
            "description": "Stable command identifier.",
            "minLength": 1,
            "maxLength": 200
          },
          "disposition": {
            "enum": [
              "applied",
              "duplicate"
            ]
          },
          "stateRevision": {
            "type": "integer",
            "minimum": 0
          },
          "entityRefs": {
            "type": "array",
            "description": "Entities affected by the operation.",
            "items": {
              "type": "string",
              "minLength": 1
            },
            "maxItems": 200,
            "uniqueItems": true
          },
          "scheduledWakeIds": {
            "type": "array",
            "description": "Wake identifiers scheduled by the operation.",
            "items": {
              "type": "string",
              "minLength": 1
            },
            "maxItems": 200,
            "uniqueItems": true
          }
        },
        "required": [
          "commandId",
          "disposition",
          "stateRevision",
          "entityRefs",
          "scheduledWakeIds"
        ],
        "additionalProperties": false
      }
    }
  },
  "scenario": {
    "order": 22,
    "descriptor": {
      "operationId": "decide_approval",
      "version": 1,
      "title": "Decide Approval",
      "description": "Decide Approval through the Capability approvals capability set.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "approvalId": {
            "type": "string",
            "minLength": 1
          },
          "decision": {
            "type": "string",
            "enum": [
              "approved",
              "rejected",
              "cancelled"
            ]
          },
          "note": {
            "type": "string",
            "minLength": 1
          }
        },
        "required": [
          "approvalId",
          "decision",
          "note"
        ],
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
            "const": "decide_approval"
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
        "approvals:approvals:decide"
      ],
      "allowedRoles": [
        "operator",
        "approver",
        "security"
      ],
      "taskModes": [
        "standard",
        "skill_test"
      ],
      "sideEffectClass": "approvals",
      "idempotency": "required",
      "redaction": [],
      "mockCommandMapping": {
        "kind": "semantic_command",
        "commandKind": "decide_approval"
      }
    }
  }
} as const;
