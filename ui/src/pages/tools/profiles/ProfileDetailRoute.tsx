import { useEffect } from "react";
import { useParams } from "@/lib/router";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useSpace } from "@/context/SpaceContext";
import { advancedTabHref } from "../tool-tabs";
import { ToolsAdminGate } from "./ToolsAdminGate";
import { ProfileDetail } from "./ProfileDetail";

export function ProfileDetailRoute() {
  const { selectedSpace, selectedSpaceId } = useSpace();
  const { setBreadcrumbs } = useBreadcrumbs();
  const params = useParams<{ profileId?: string }>();

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedSpace?.name ?? "Outpost", href: "/dashboard" },
      { label: "Apps", href: "/apps" },
      { label: "Access profiles", href: advancedTabHref("profiles") },
      { label: "Profile detail" },
    ]);
    return () => setBreadcrumbs([]);
  }, [setBreadcrumbs, selectedSpace?.name]);

  if (!selectedSpaceId || !params.profileId) {
    return <div className="p-6 text-sm text-muted-foreground">Select an outpost and profile.</div>;
  }

  return (
    <ToolsAdminGate>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 sm:p-6">
        <ProfileDetail spaceId={selectedSpaceId} profileId={params.profileId} />
      </div>
    </ToolsAdminGate>
  );
}
