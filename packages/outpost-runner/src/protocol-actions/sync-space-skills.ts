/** Canonical definition and documentation for `sync_space_skills`. */
export const syncSpaceSkillsAction = {
  "id": "sync_space_skills",
  "canonical": {
    "operationId": "sync_space_skills",
    "surfaces": [
      "scenario"
    ],
    "placement": "optional_agent_tool",
    "optionalGroup": "space_skills",
    "requiredClaims": [
      "space_skills:write"
    ],
    "taskModes": [
      "standard",
      "skill_test"
    ],
    "sideEffectClass": "admin",
    "idempotency": "required",
    "disabledByDefault": false,
    "realBindingStatus": "scenario_mock",
    "realServiceBinding": "unbound",
    "orpEvidence": "space admin/portability item event plus audit record",
    "orpBindingStatus": "audit_pending",
    "legacyAliases": [],
    "note": "Scenario/eval-only mock extension."
  },
  "documentation": {
    "title": "Sync Outpost Skills",
    "description": "Sync Outpost Skills through the Capability space skills capability set.",
    "note": "Scenario/eval-only mock extension."
  },
  "examples": {
    "call": {
      "operationId": "sync_space_skills",
      "input": {}
    },
    "scenarioCall": {
      "operationId": "sync_space_skills",
      "idempotencyKey": "example",
      "input": {}
    },
    "success": {
      "ok": true,
      "operationId": "sync_space_skills",
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
    "order": 31,
    "descriptor": {
      "operationId": "sync_space_skills",
      "version": 1,
      "title": "Sync Outpost Skills",
      "description": "Sync Outpost Skills through the Capability space skills capability set.",
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
        "space_skills:write"
      ],
      "taskModes": [
        "standard",
        "skill_test"
      ],
      "sideEffectClass": "admin",
      "idempotency": "required",
      "redaction": [],
      "mockCommandMapping": {
        "kind": "mock_extension",
        "extension": "space_skills.sync"
      }
    }
  }
} as const;
