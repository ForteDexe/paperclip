import { lazy, useEffect } from "react";
import { useDialogActions, useDialogState } from "../context/DialogContext";
import { useLocation } from "../lib/router";
import { isOnboardingPath } from "../lib/onboarding-route";
import { DeferredOverlay } from "./DeferredOverlay";

const OnboardingWizard = lazy(() => import("./OnboardingWizard").then((module) => ({ default: module.OnboardingWizard })));

/**
 * Default onboarding wizard.
 */
export function OnboardingWizardVariant() {
  const { onboardingOpen, onboardingRouteDismissed } = useDialogState();
  const { closeOnboarding, setOnboardingRouteDismissed } = useDialogActions();
  const { pathname } = useLocation();
  useEffect(() => {
    setOnboardingRouteDismissed(false);
  }, [pathname, setOnboardingRouteDismissed]);
  const requested = onboardingOpen || (isOnboardingPath(pathname) && !onboardingRouteDismissed);
  return <DeferredOverlay requested={requested} title="Setup" onClose={() => {
    closeOnboarding();
    if (isOnboardingPath(pathname)) setOnboardingRouteDismissed(true);
  }}><OnboardingWizard /></DeferredOverlay>;
}
