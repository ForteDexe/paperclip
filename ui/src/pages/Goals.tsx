import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { productLabel } from "@outpost/shared/product-vocabulary";
import { goalsApi } from "../api/goals";
import { useSpace } from "../context/SpaceContext";
import { useDialogActions } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { GoalTree } from "../components/GoalTree";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { QueryErrorState, useQueryView } from "../components/QueryView";
import { Button } from "@/components/ui/button";
import { Target, Plus } from "lucide-react";

const northStar = productLabel("northStar");
const northStars = productLabel("northStar", { count: 2 });
const lowerNorthStars = productLabel("northStar", { count: 2, casing: "lower" });
const lowerSpace = productLabel("space", { casing: "lower" });

export function Goals() {
  const { selectedSpaceId } = useSpace();
  const { openNewGoal } = useDialogActions();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: northStars }]);
  }, [setBreadcrumbs]);

  const goalsQuery = useQuery({
    queryKey: queryKeys.goals.list(selectedSpaceId!),
    queryFn: () => goalsApi.list(selectedSpaceId!),
    enabled: !!selectedSpaceId,
  });
  const { data: goals, isLoading } = goalsQuery;
  const goalsView = useQueryView(goalsQuery);

  if (!selectedSpaceId) {
    return <EmptyState icon={Target} message={`Select a ${lowerSpace} to view ${lowerNorthStars}.`} />;
  }

  // Keep a loaded list on screen through a failed refetch; only a real
  // failure, or an outage before the first load, replaces the page.
  if (isLoading || goalsView.kind === "reconnecting") {
    return <PageSkeleton variant="list" />;
  }
  if (goalsView.kind === "error") {
    return (
      <QueryErrorState
        size="page"
        error={goalsView.error}
        action={`load ${lowerNorthStars}`}
        onRetry={goalsView.retry}
        retrying={goalsView.isFetching}
      />
    );
  }

  return (
    <div className="space-y-4">
      {goals && goals.length === 0 && (
        <EmptyState
          icon={Target}
          message={`No ${lowerNorthStars} yet.`}
          action={`Add ${northStar}`}
          onAction={() => openNewGoal()}
        />
      )}

      {goals && goals.length > 0 && (
        <>
          <div className="flex items-center justify-start">
            <Button size="sm" variant="outline" onClick={() => openNewGoal()}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              New {northStar}
            </Button>
          </div>
          <GoalTree goals={goals} goalLink={(goal) => `/goals/${goal.id}`} />
        </>
      )}
    </div>
  );
}
