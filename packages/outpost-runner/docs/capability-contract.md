<!-- GENERATED FILE — DO NOT EDIT. Run pnpm generate:capability-inventory. -->

# Capability Capability Contract

This generated contract is a self-contained derivative of the focused Outpost skills and references, the Outpost Evals corpus, and the legacy MCP tool surface. It does not import or contact the Outpost control plane.

The skill/reference inventory and eval cases are the only normative behavior sources. Outpost does not use the legacy MCP calls as a production capability surface; all MCP names below are traceability aliases folded into normative eval rows. Their disposition, grants, assertions, and evidence contract are inherited from the target row rather than classified independently.

## Baseline Counts

- Skill/reference headings: 29
- Eval cases: 106 across 16 groups
- Total normative rows: 135
- Legacy MCP aliases folded into normative rows: 42

| Eval group | Cases |
| --- | ---: |
| hb | 5 |
| co | 6 |
| st | 8 |
| cm | 6 |
| se | 4 |
| su | 4 |
| bl | 5 |
| dp | 3 |
| ix | 9 |
| ap | 6 |
| ar | 4 |
| er | 9 |
| rf | 22 |
| mh | 4 |
| rs | 3 |
| wk | 8 |

## Regeneration

- `pnpm --dir packages/outpost-runner generate:capability-inventory` imports the canonical baselines and rewrites every generated file.
- `pnpm --dir packages/outpost-runner check:capability-inventory` validates counts, uniqueness, normative dispositions, one-to-one MCP folds, required fields, and generated-file drift without requiring the external eval repository.

## Skill / Reference Rows

| Capability | Primary disposition | Source anchor |
| --- | --- | --- |
| skill:skills/outpost-task/SKILL.md:outpost-task:6 | optional_agent_tool | skills/outpost-task/SKILL.md:6 |
| skill:skills/outpost-task/SKILL.md:run-context:14 | optional_agent_tool | skills/outpost-task/SKILL.md:14 |
| skill:skills/outpost-task/SKILL.md:task-loop:28 | optional_agent_tool | skills/outpost-task/SKILL.md:28 |
| skill:skills/outpost-task/SKILL.md:update-helper:43 | optional_agent_tool | skills/outpost-task/SKILL.md:43 |
| skill:skills/outpost-task/references/api-reference.md:task-api:1 | optional_agent_tool | skills/outpost-task/references/api-reference.md:1 |
| skill:skills/outpost-task/references/api-reference.md:endpoints:6 | optional_agent_tool | skills/outpost-task/references/api-reference.md:6 |
| skill:skills/outpost-task/references/api-reference.md:checkout:18 | control_plane_owned | skills/outpost-task/references/api-reference.md:18 |
| skill:skills/outpost-task/references/api-reference.md:updates-and-comments:32 | always_agent_tool | skills/outpost-task/references/api-reference.md:32 |
| skill:skills/outpost-task/references/api-reference.md:errors:49 | optional_agent_tool | skills/outpost-task/references/api-reference.md:49 |
| skill:skills/outpost-task/references/task-documents.md:task-documents:1 | always_agent_tool | skills/outpost-task/references/task-documents.md:1 |
| skill:skills/outpost-task/references/task-documents.md:create:7 | optional_agent_tool | skills/outpost-task/references/task-documents.md:7 |
| skill:skills/outpost-task/references/task-documents.md:update-safely:29 | optional_agent_tool | skills/outpost-task/references/task-documents.md:29 |
| skill:skills/outpost-task/references/task-documents.md:link:38 | optional_agent_tool | skills/outpost-task/references/task-documents.md:38 |
| skill:skills/outpost-decision/SKILL.md:outpost-decision:6 | optional_agent_tool | skills/outpost-decision/SKILL.md:6 |
| skill:skills/outpost-decision/references/api-reference.md:decision-api:1 | optional_agent_tool | skills/outpost-decision/references/api-reference.md:1 |
| skill:skills/outpost-decision/references/api-reference.md:yes-no-confirmation:12 | always_agent_tool | skills/outpost-decision/references/api-reference.md:12 |
| skill:skills/outpost-decision/references/api-reference.md:questions:31 | always_agent_tool | skills/outpost-decision/references/api-reference.md:31 |
| skill:skills/outpost-artifact/SKILL.md:outpost-artifact:6 | always_agent_tool | skills/outpost-artifact/SKILL.md:6 |
| skill:skills/outpost-artifact/references/api-reference.md:artifact-api:1 | always_agent_tool | skills/outpost-artifact/references/api-reference.md:1 |
| skill:skills/outpost-case/SKILL.md:outpost-case:6 | optional_agent_tool | skills/outpost-case/SKILL.md:6 |
| skill:skills/outpost-case/references/api-reference.md:case-api:1 | optional_agent_tool | skills/outpost-case/references/api-reference.md:1 |
| skill:skills/outpost-case/references/api-reference.md:create-or-upsert:3 | optional_agent_tool | skills/outpost-case/references/api-reference.md:3 |
| skill:skills/outpost-case/references/api-reference.md:read-and-search:26 | optional_agent_tool | skills/outpost-case/references/api-reference.md:26 |
| skill:skills/outpost-case/references/api-reference.md:link-the-current-task:33 | optional_agent_tool | skills/outpost-case/references/api-reference.md:33 |
| skill:skills/outpost-case/references/api-reference.md:durable-findings:48 | optional_agent_tool | skills/outpost-case/references/api-reference.md:48 |
| skill:skills/outpost-north-star/SKILL.md:outpost-north-star:6 | optional_agent_tool | skills/outpost-north-star/SKILL.md:6 |
| skill:skills/outpost-north-star/references/api-reference.md:north-star-api:1 | optional_agent_tool | skills/outpost-north-star/references/api-reference.md:1 |
| skill:skills/outpost-delegation/SKILL.md:outpost-delegation:6 | optional_agent_tool | skills/outpost-delegation/SKILL.md:6 |
| skill:skills/outpost-delegation/references/api-reference.md:delegation-api:1 | optional_agent_tool | skills/outpost-delegation/references/api-reference.md:1 |

## Legacy MCP Alias Index

This is a compatibility/traceability index, not a tool catalog. “Inherited disposition” is shown only to make the normative target easy to audit.

| Legacy MCP name | Folded into normative row | Inherited disposition | Source anchor |
| --- | --- | --- | --- |
| outpostMe | eval:hb-inbox-lite-01 | control_plane_owned | packages/mcp-server/src/tools.ts:290 |
| outpostInboxLite | eval:hb-inbox-lite-01 | control_plane_owned | packages/mcp-server/src/tools.ts:296 |
| outpostListAgents | eval:rf-api-mgr-heartbeat-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:302 |
| outpostListSkills | eval:rf-cskill-audit-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:308 |
| outpostGetAgent | eval:rf-api-mgr-heartbeat-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:314 |
| outpostListIssues | eval:se-q-filters-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:323 |
| outpostGetIssue | eval:se-get-issue-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:338 |
| outpostGetHeartbeatContext | eval:hb-context-01 | control_plane_owned | packages/mcp-server/src/tools.ts:344 |
| outpostListComments | eval:se-get-issue-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:353 |
| outpostGetComment | eval:hb-wake-comment-01 | control_plane_owned | packages/mcp-server/src/tools.ts:366 |
| outpostListIssueApprovals | eval:ap-board-approval-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:373 |
| outpostListDocuments | eval:dp-base-revision-01 | always_agent_tool | packages/mcp-server/src/tools.ts:379 |
| outpostGetDocument | eval:dp-base-revision-01 | always_agent_tool | packages/mcp-server/src/tools.ts:385 |
| outpostListDocumentRevisions | eval:dp-base-revision-01 | always_agent_tool | packages/mcp-server/src/tools.ts:392 |
| outpostListProjects | eval:rf-wf-project-setup-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:402 |
| outpostGetProject | eval:rf-wf-project-setup-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:408 |
| outpostGetIssueWorkspaceRuntime | eval:rf-iws-start-url-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:417 |
| outpostControlIssueWorkspaceServices | eval:rf-iws-start-url-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:423 |
| outpostWaitForIssueWorkspaceService | eval:rf-iws-target-restart-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:440 |
| outpostListGoals | eval:su-parent-goal-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:466 |
| outpostGetGoal | eval:su-parent-goal-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:472 |
| outpostListApprovals | eval:ap-approval-wake-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:478 |
| outpostCreateApproval | eval:ap-board-approval-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:487 |
| outpostGetApproval | eval:ap-approval-wake-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:496 |
| outpostGetApprovalIssues | eval:ap-approval-wake-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:502 |
| outpostListApprovalComments | eval:ap-approval-deny-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:508 |
| outpostCreateIssue | eval:su-parent-goal-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:514 |
| outpostUpdateIssue | eval:st-done-comment-01 | always_agent_tool | packages/mcp-server/src/tools.ts:521 |
| outpostCheckoutIssue | eval:co-body-contract-01 | control_plane_owned | packages/mcp-server/src/tools.ts:528 |
| outpostReleaseIssue | eval:er-release-01 | control_plane_owned | packages/mcp-server/src/tools.ts:540 |
| outpostAddComment | eval:cm-multiline-01 | always_agent_tool | packages/mcp-server/src/tools.ts:546 |
| outpostSuggestTasks | eval:ix-suggest-tasks-01 | always_agent_tool | packages/mcp-server/src/tools.ts:553 |
| outpostAskUserQuestions | eval:ix-questions-01 | always_agent_tool | packages/mcp-server/src/tools.ts:565 |
| outpostRequestConfirmation | eval:ix-confirmation-plan-01 | always_agent_tool | packages/mcp-server/src/tools.ts:577 |
| outpostRequestCheckboxConfirmation | eval:ix-checkbox-01 | always_agent_tool | packages/mcp-server/src/tools.ts:589 |
| outpostUpsertIssueDocument | eval:dp-plan-doc-01 | always_agent_tool | packages/mcp-server/src/tools.ts:601 |
| outpostRestoreIssueDocumentRevision | eval:dp-base-revision-01 | always_agent_tool | packages/mcp-server/src/tools.ts:612 |
| outpostLinkIssueApproval | eval:ap-board-approval-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:627 |
| outpostUnlinkIssueApproval | eval:ap-board-approval-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:636 |
| outpostApprovalDecision | eval:ap-approval-wake-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:646 |
| outpostAddApprovalComment | eval:ap-approval-deny-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:668 |
| outpostApiRequest | eval:rf-api-404-report-01 | optional_agent_tool | packages/mcp-server/src/tools.ts:677 |
