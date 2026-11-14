import { AgentAvatar } from "@/components/AgentAvatar";
import { useState, type ReactElement } from "react";
import type { Agent } from "@outpost/shared";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FlyoutAppearanceProvider, FlyoutHeader, FlyoutOptions } from "./ui/flyout";
import { Check, User } from "lucide-react";
import { cn } from "../lib/utils";

export function CoordinationLeadPicker({
  agents,
  value,
  onChange,
  disabled = false,
  excludeAgentIds = [],
  disabledEmptyLabel = "Coordination lead: N/A (Default agent)",
  chooseLabel = "Coordination lead...",
  trigger,
  disabledAgentIds = [],
}: {
  agents: Agent[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  excludeAgentIds?: string[];
  disabledEmptyLabel?: string;
  chooseLabel?: string;
  trigger?: ReactElement;
  disabledAgentIds?: string[];
}) {
  const [open, setOpen] = useState(false);
  const exclude = new Set(excludeAgentIds);
  const rows = agents.filter(
    (a) => a.status !== "terminated" && !exclude.has(a.id),
  );
  const current = value ? agents.find((a) => a.id === value) : null;
  const terminatedLead = current?.status === "terminated";
  const unknownLead = Boolean(value && !current);

  return (
    <FlyoutAppearanceProvider><Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? <button
          type="button"
          className={cn(
            "inline-flex max-w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-md border border-border px-2 py-1 text-xs hover:bg-accent/50 transition-colors",
            terminatedLead && "border-amber-600/45 bg-amber-500/5",
            disabled && "opacity-60 cursor-not-allowed",
          )}
          disabled={disabled}
        >
          {unknownLead ? (
            <>
              <User className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate text-muted-foreground">Unknown coordination lead (stale ID)</span>
            </>
          ) : current ? (
            <>
              <AgentAvatar agent={current} size={16} className="h-3 w-3 shrink-0 text-muted-foreground"/>
              <span
                className={cn(
                  "min-w-0 truncate",
                  terminatedLead && "text-amber-900 dark:text-amber-200",
                )}
              >
                {`Coordination lead ${current.name}${terminatedLead ? " (terminated)" : ""}`}
              </span>
            </>
          ) : (
            <>
              <User className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">
                {disabled ? disabledEmptyLabel : chooseLabel}
              </span>
            </>
          )}
        </button>}
      </PopoverTrigger>
      <PopoverContent className="w-64" align="start" aria-label="Choose coordination lead">
        <FlyoutHeader>Coordination lead</FlyoutHeader>
        <FlyoutOptions className="max-h-80 overflow-y-auto">
        <button
          type="button"
          aria-pressed={value === null}
          className={cn(
            "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50",
            value === null && "bg-accent",
          )}
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
        >
          <User className="size-5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 text-left">No coordination lead</span>
          {value === null && <Check className="size-4 shrink-0" aria-hidden />}
        </button>
        {terminatedLead && (
          <div className="flex min-w-0 items-center gap-2 overflow-hidden px-2 py-1.5 text-xs text-muted-foreground border-b border-border mb-0.5">
            <AgentAvatar agent={current} size={16} className="shrink-0 h-3 w-3"/>
            <span className="min-w-0 truncate">
              Current: {current.name} (terminated)
            </span>
          </div>
        )}
        {unknownLead && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground border-b border-border mb-0.5">
            The saved coordination lead is missing from this outpost. Choose a new lead or clear the link.
          </div>
        )}
        {rows.map((a) => (
          <button
            type="button"
            key={a.id}
            aria-pressed={a.id === value}
            disabled={disabledAgentIds.includes(a.id)}
            title={disabledAgentIds.includes(a.id) ? "Would create a coordination loop" : undefined}
            className={cn(
              "flex items-center gap-2 w-full min-w-0 px-2 py-1.5 text-xs rounded hover:bg-accent/50 overflow-hidden disabled:opacity-50 disabled:cursor-not-allowed",
              a.id === value && "bg-accent",
            )}
            onClick={() => {
              onChange(a.id);
              setOpen(false);
            }}
          >
            <AgentAvatar agent={a} size={24} className="size-6 shrink-0"/>
            <span className="min-w-0 flex-1 truncate text-left">{a.name}</span>
            {a.id === value && <Check className="size-4 shrink-0" aria-hidden />}
          </button>
        ))}
        </FlyoutOptions>
      </PopoverContent>
    </Popover></FlyoutAppearanceProvider>
  );
}
