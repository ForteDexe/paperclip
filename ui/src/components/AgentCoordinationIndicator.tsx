import { Crown } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function AgentCoordinationIndicator({ directReportCount }: { directReportCount: number }) {
  if (directReportCount <= 0) return null;
  const label = directReportCount === 1
    ? "Coordinates 1 agent"
    : `Coordinates ${directReportCount} agents`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="img" aria-label={label} className="inline-flex shrink-0 text-muted-foreground">
          <Crown aria-hidden="true" className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
