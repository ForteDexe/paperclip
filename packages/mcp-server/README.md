# Outpost MCP Server

Model Context Protocol server for Outpost.

This package is a thin MCP wrapper over the existing Outpost REST API. It does
not talk to the database directly and it does not reimplement business logic.

## Authentication

The server reads its configuration from environment variables:

- `OUTPOST_API_URL` - Outpost base URL, for example `http://localhost:3100`
- `OUTPOST_API_KEY` - bearer token used for `/api` requests
- `OUTPOST_SPACE_ID` - optional default space for space-scoped tools
- `OUTPOST_AGENT_ID` - optional default agent for checkout helpers
- `OUTPOST_RUN_ID` - optional run id forwarded on mutating requests

Inside an active heartbeat, Outpost also injects `OUTPOST_RUNTIME_TOOLS_*` variables. They enable the run-scoped `connections_search` and `connection_request` tools and expire with the run.

## Usage

```sh
npx -y @outpost/mcp-server
```

Or locally in this repo:

```sh
pnpm --filter @outpost/mcp-server build
node packages/mcp-server/dist/stdio.js
```

## Tool Surface

Run-scoped connection tools:

- `connections_search`
- `connection_request`

Read tools:

- `outpostMe`
- `outpostInboxLite`
- `outpostListAgents`
- `outpostGetAgent`
- `outpostListIssues`
- `outpostGetIssue`
- `outpostGetHeartbeatContext`
- `outpostListComments`
- `outpostGetComment`
- `outpostListIssueApprovals`
- `outpostListDocuments`
- `outpostGetDocument`
- `outpostListDocumentRevisions`
- `outpostListProjects`
- `outpostGetProject`
- `outpostGetIssueWorkspaceRuntime`
- `outpostWaitForIssueWorkspaceService`
- `outpostListGoals`
- `outpostGetGoal`
- `outpostListApprovals`
- `outpostGetApproval`
- `outpostGetApprovalIssues`
- `outpostListApprovalComments`

Write tools:

- `outpostCreateIssue`
- `outpostUpdateIssue`
- `outpostCheckoutIssue`
- `outpostReleaseIssue`
- `outpostAddComment`
- `outpostSuggestTasks`
- `outpostAskUserQuestions`
- `outpostRequestConfirmation`
- `outpostUpsertIssueDocument`
- `outpostRestoreIssueDocumentRevision`
- `outpostControlIssueWorkspaceServices`
- `outpostCreateApproval`
- `outpostLinkIssueApproval`
- `outpostUnlinkIssueApproval`
- `outpostApprovalDecision`
- `outpostAddApprovalComment`

Escape hatch:

- `outpostApiRequest`

`outpostApiRequest` is limited to paths under `/api` and JSON bodies. It is
meant for endpoints that do not yet have a dedicated MCP tool.
