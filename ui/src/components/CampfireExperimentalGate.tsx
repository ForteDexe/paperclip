import type { ReactNode } from "react";
import { Navigate } from "@/lib/router";
import { useCampfireEnabled } from "@/hooks/useCampfireEnabled";

export function CampfireExperimentalGate({ children }: { children: ReactNode }) {
  const { enabled, loaded } = useCampfireEnabled();
  if (!loaded) return null;
  return enabled ? <>{children}</> : <Navigate to="/dashboard" replace />;
}
