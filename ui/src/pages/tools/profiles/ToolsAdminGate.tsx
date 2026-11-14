import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { Link } from "@/lib/router";
import { accessApi } from "@/api/access";
import { QueryErrorState, useQueryView } from "@/components/QueryView";
import { queryKeys } from "@/lib/queryKeys";
import { useSpace } from "@/context/SpaceContext";

/**
 * Best-effort admin gate for the access-profiles surface, mirroring
 * `AdvancedToolsRoute` (PAP-10862, plan D8). Local operators, instance admins,
 * and active space owners/admins/operators pass; the server stays
 * authoritative. Shared so the profiles index and create wizard guard identically.
 *
 * An outage before the first load is a placeholder, never a denial: the
 * denial card is only for a loaded answer (or a real 403).
 */
export function ToolsAdminGate({ children }: { children: ReactNode }) {
  const { selectedSpaceId } = useSpace();
  const operatorAccess = useQuery({
    queryKey: queryKeys.access.currentOperatorAccess,
    queryFn: () => accessApi.getCurrentOperatorAccess(),
  });
  const view = useQueryView(operatorAccess);

  if (operatorAccess.isLoading || view.kind === "reconnecting") {
    return <div className="mx-auto max-w-xl py-10 text-sm text-muted-foreground">Loading…</div>;
  }
  if (view.kind === "error" && view.errorKind !== "forbidden") {
    return (
      <div className="mx-auto max-w-xl py-10">
        <QueryErrorState
          error={operatorAccess.error}
          action="check your access"
          onRetry={view.retry}
          retrying={view.isFetching}
        />
      </div>
    );
  }

  const data = operatorAccess.data;
  const membership = data?.memberships?.find((m) => m.spaceId === selectedSpaceId && m.status === "active");
  const canManageTools =
    data?.source === "local_implicit" ||
    Boolean(data?.isInstanceAdmin) ||
    membership?.membershipRole === "owner" ||
    membership?.membershipRole === "admin" ||
    membership?.membershipRole === "operator" ||
    membership?.membershipRole === "member";

  if (!canManageTools) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6">
          <div className="flex items-center gap-2 text-foreground">
            <ShieldAlert className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold">Access profiles require editing access</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Access profiles decide which tools your agents can use. Ask a outpost editor to set these up, or
            head back to{" "}
            <Link to="/apps" className="font-medium text-primary hover:underline">
              your apps
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
