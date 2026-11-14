import type { AgentDetail as AgentDetailRecord } from "@outpost/shared";
import { AuditFeed } from "./audit/AuditFeed";
import { AuditRuns } from "./audit/AuditRuns";
import type { AgentAuditView } from "./agent-detail-navigation";

export function AgentAuditTab({
  agent,
  spaceId,
  section,
}: {
  agent: AgentDetailRecord;
  spaceId: string;
  section: AgentAuditView;
}) {
  if (section === "activity") return <AuditFeed spaceId={spaceId} lockedAgentId={agent.id} hideHeader />;
  return <AuditRuns spaceId={spaceId} lockedAgentId={agent.id} hideHeader />;
}
