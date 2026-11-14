/** Canonical definition and documentation for `list_space_skills`. */
export const listSpaceSkillsAction = {
  "id": "list_space_skills",
  "canonical": {
    "operationId": "list_space_skills",
    "surfaces": [
      "scenario"
    ],
    "placement": "optional_agent_tool",
    "optionalGroup": "space_skills",
    "requiredClaims": [
      "space_skills:read"
    ],
    "taskModes": [
      "standard",
      "skill_test"
    ],
    "sideEffectClass": "read",
    "idempotency": "none",
    "disabledByDefault": false,
    "realBindingStatus": "scenario_mock",
    "realServiceBinding": "unbound",
    "orpEvidence": "read projection surfaced via a tool-result item event; no control-plane state diff",
    "orpBindingStatus": "audit_pending",
    "legacyAliases": [],
    "note": "Scenario/eval-only mock extension."
  },
  "documentation": {
    "title": "List Outpost Skills",
    "description": "List Outpost Skills through the Capability space skills capability set.",
    "note": "Scenario/eval-only mock extension."
  },
  "examples": {
    "call": {
      "operationId": "list_space_skills",
      "input": {}
    },
    "success": {
      "ok": true,
      "operationId": "list_space_skills",
      "result": {
        "schema": "outpost.capability.tool-result.v1",
        "ok": true,
        "operationId": "example",
        "operationResultId": "example",
        "value": "example",
        "commandResult": "example",
        "authorization": "example"
      }
    }
  },
  "live": null,
  "scenario": {
    "order": 30,
    "descriptor": {
      "operationId": "list_space_skills",
      "version": 1,
      "title": "List Outpost Skills",
      "description": "List Outpost Skills through the Capability space skills capability set.",
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
            "type": "string",
            "minLength": 1
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
      "optionalGroup": "space_skills",
      "requiredClaims": [
        "space_skills:read"
      ],
      "taskModes": [
        "standard",
        "skill_test"
      ],
      "sideEffectClass": "read",
      "idempotency": "none",
      "redaction": [],
      "mockCommandMapping": {
        "kind": "mock_extension",
        "extension": "space_skills.list"
      }
    }
  }
} as const;
