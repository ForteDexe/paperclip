import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

// The original Campfire mod used this braille sequence as its compact working
// indicator. Keep the same cadence and shape in the built-in experience.
export const CAMPFIRE_RUNNING_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export function campfireAgentStatusLabel(status: string) {
  if (status === "running") return "running";
  if (status === "paused") return "paused";
  if (status === "pending_approval") return "waiting for approval";
  if (status === "error") return "error";
  if (status === "terminated") return "offline";
  return "resting";
}

export function CampfireAgentStatus({ status, name }: { status: string; name: string }) {
  const [frame, setFrame] = useState(0);
  const label = `${name} is ${campfireAgentStatusLabel(status)}`;

  useEffect(() => {
    if (status !== "running") {
      setFrame(0);
      return;
    }
    const timer = window.setInterval(() => {
      setFrame((current) => (current + 1) % CAMPFIRE_RUNNING_FRAMES.length);
    }, 90);
    return () => window.clearInterval(timer);
  }, [status]);

  if (status === "running") {
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className="inline-flex size-3 shrink-0 items-center justify-center text-[11px] leading-none text-blue-400"
      >
        {CAMPFIRE_RUNNING_FRAMES[frame]}
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="inline-flex size-3 shrink-0 items-center justify-center"
    >
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          status === "paused" && "bg-yellow-400",
          status === "pending_approval" && "animate-pulse bg-amber-400",
          status === "error" && "bg-red-400",
          status === "terminated" && "border border-muted-foreground/60",
          !["paused", "pending_approval", "error", "terminated"].includes(status) &&
            "border border-muted-foreground",
        )}
      />
    </span>
  );
}
