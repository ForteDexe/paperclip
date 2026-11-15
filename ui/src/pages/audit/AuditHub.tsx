import { useCallback, useEffect } from "react";
import { History } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { PageTabBar } from "@/components/PageTabBar";
import { Tabs } from "@/components/ui/tabs";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useSpace } from "@/context/SpaceContext";
import { useNavigate, useSearchParams } from "@/lib/router";
import { Timeline } from "@/pages/Timeline";
import { AuditFeed, type AuditFeedMode } from "./AuditFeed";
import { AuditRuns } from "./AuditRuns";
import { AgentCommentary } from "./AgentCommentary";
import {
  AUDIT_SECTIONS,
  auditScopeFromSearchParams,
  auditSectionHref,
  type AuditSection,
} from "./audit-navigation";

export function AuditHub({ section }: { section: AuditSection }) {
  const navigate = useNavigate();
  const { selectedSpaceId } = useSpace();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [searchParams, setSearchParams] = useSearchParams();
  const scope = auditScopeFromSearchParams(searchParams);
  const mode: AuditFeedMode = scope.mode === "agents" ? "agents" : "all";
  const actionParam = searchParams.get("action");
  const actionDomain = [
    "issue.",
    "case.",
    "agent.",
    "heartbeat.",
    "approval.",
    "project.",
    "goal.",
    "tool_",
    "space.",
  ].includes(actionParam ?? "") ? actionParam! : "__all";

  useEffect(() => {
    const current = AUDIT_SECTIONS.find((candidate) => candidate.value === section);
    setBreadcrumbs([
      { label: "Audit", href: section === "activity" ? undefined : "/activity" },
      ...(section === "activity" || !current ? [] : [{ label: current.label }]),
    ]);
  }, [section, setBreadcrumbs]);

  const handleModeChange = useCallback(
    (next: AuditFeedMode) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          if (next === "agents") params.set("mode", "agents");
          else params.delete("mode");
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const handleActionDomainChange = useCallback(
    (next: string) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          if (next === "__all") params.delete("action");
          else params.set("action", next);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const handleEntityTypeChange = useCallback((next: string) => {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (next === "__all") params.delete("entityType");
      else params.set("entityType", next);
      params.delete("entityId");
      return params;
    }, { replace: true });
  }, [setSearchParams]);

  const handleEntityIdChange = useCallback((next: string) => {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (next.trim()) params.set("entityId", next);
      else params.delete("entityId");
      return params;
    }, { replace: true });
  }, [setSearchParams]);

  const handleClearFilters = useCallback(() => {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      params.delete("action");
      params.delete("entityType");
      params.delete("entityId");
      return params;
    }, { replace: true });
  }, [setSearchParams]);

  if (!selectedSpaceId) {
    return <EmptyState icon={History} message="Select an outpost to view Audit." />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Audit</h1>
      </div>

      <Tabs
        value={section}
        onValueChange={(value) => {
          const next = value as AuditSection;
          navigate(auditSectionHref(next, scope));
        }}
      >
        <PageTabBar items={AUDIT_SECTIONS} value={section} align="start" />
      </Tabs>

      {section === "commentary" ? (
        <AgentCommentary key={selectedSpaceId} spaceId={selectedSpaceId} />
      ) : section === "activity" ? (
        <AuditFeed
          spaceId={selectedSpaceId}
          hideHeader
          mode={mode}
          onModeChange={handleModeChange}
          actionDomain={actionDomain}
          onActionDomainChange={handleActionDomainChange}
          entityType={scope.entityType ?? "__all"}
          onEntityTypeChange={handleEntityTypeChange}
          entityId={scope.entityId ?? ""}
          onEntityIdChange={handleEntityIdChange}
          onClearFilters={handleClearFilters}
          lockedAgentId={scope.agentId ?? undefined}
          lockedRunId={scope.runId ?? undefined}
          lockedEntity={
            scope.entityType && scope.entityId
              ? { type: scope.entityType, id: scope.entityId }
              : undefined
          }
        />
      ) : section === "runs" ? (
        <AuditRuns spaceId={selectedSpaceId} />
      ) : section === "timeline" ? (
        <Timeline embedded />
      ) : (
        <AuditFeed spaceId={selectedSpaceId} hideHeader />
      )}
    </div>
  );
}
