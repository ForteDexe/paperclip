import type { AgentDetail as AgentDetailRecord } from "@outpost/shared";
import { AuditFeed } from "./audit/AuditFeed";
import { AuditRuns } from "./audit/AuditRuns";
import type { AgentAuditView } from "./agent-detail-navigation";

export function AgentAuditTab({
  agent,
  companyId,
  section,
}: {
  agent: AgentDetailRecord;
  companyId: string;
  section: AgentAuditView;
}) {
  if (section === "activity") return <AuditFeed companyId={companyId} lockedAgentId={agent.id} hideHeader />;
  return <AuditRuns companyId={companyId} lockedAgentId={agent.id} hideHeader />;
}
