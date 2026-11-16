import { TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TaskChatItem } from "@/components/task-chat/task-chat-model";

const DISMISSED_ALERTS_PREFIX = "outpost:dismissed-conversation-alerts:";
const MAX_DISMISSED_ALERTS_PER_SCOPE = 200;

function readDismissedAlerts(scope: string): ReadonlySet<string> {
  try {
    const stored = window.localStorage.getItem(`${DISMISSED_ALERTS_PREFIX}${scope}`);
    const ids = stored ? JSON.parse(stored) : [];
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function writeDismissedAlerts(scope: string, ids: ReadonlySet<string>) {
  try {
    window.localStorage.setItem(
      `${DISMISSED_ALERTS_PREFIX}${scope}`,
      JSON.stringify([...ids].slice(-MAX_DISMISSED_ALERTS_PER_SCOPE)),
    );
  } catch {
    // Dismissal still works for this mount when storage is unavailable.
  }
}

export function useDismissedConversationAlerts(scope: string) {
  const [snapshot, setSnapshot] = useState(() => ({ scope, ids: readDismissedAlerts(scope) }));
  const dismissedIds = snapshot.scope === scope ? snapshot.ids : readDismissedAlerts(scope);

  useEffect(() => {
    if (snapshot.scope !== scope) setSnapshot({ scope, ids: readDismissedAlerts(scope) });
  }, [scope, snapshot.scope]);

  const dismiss = useCallback((ids: Iterable<string>) => {
    setSnapshot((current) => {
      const next = new Set(current.scope === scope ? current.ids : readDismissedAlerts(scope));
      for (const id of ids) next.add(id);
      const bounded = new Set([...next].slice(-MAX_DISMISSED_ALERTS_PER_SCOPE));
      writeDismissedAlerts(scope, bounded);
      return { scope, ids: bounded };
    });
  }, [scope]);

  return { dismissedIds, dismiss };
}

export function partitionConversationFailureItems(items: readonly TaskChatItem[]) {
  const failures: Extract<TaskChatItem, { kind: "marker" }>[] = [];
  const rest: TaskChatItem[] = [];
  for (const item of items) {
    if (
      item.kind === "marker" &&
      item.variant === "interrupted" &&
      item.tone === "error" &&
      !item.credentialAccess
    ) {
      failures.push(item);
    } else {
      rest.push(item);
    }
  }
  return { failures, rest };
}

export function ConversationAlertBanner({
  title,
  detail,
  tone = "error",
  onDismiss,
  action,
}: {
  title: string;
  detail?: string | null;
  tone?: "error" | "warning";
  onDismiss: () => void;
  action?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  return (
    <div
      role="alert"
      className={cn(
        "shrink-0 border-b px-4 py-2",
        tone === "error"
          ? "border-destructive/30 bg-destructive/10"
          : "border-amber-500/30 bg-amber-500/10",
      )}
    >
      <div className="mx-auto flex w-full max-w-(--tc-shell-max-w) items-start gap-2 text-sm">
        <TriangleAlert
          aria-hidden
          className={cn("mt-0.5 size-4 shrink-0", tone === "error" ? "text-destructive" : "text-amber-500")}
        />
        <p className="min-w-0 flex-1 break-words">
          <span className="font-medium text-foreground">{title}</span>
          {detail ? <span className="text-muted-foreground"> · {detail}</span> : null}
        </p>
        {action ? (
          <Button type="button" variant="ghost" size="sm" disabled={action.disabled} onClick={action.onClick}>
            {action.label}
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Dismiss alert" onClick={onDismiss}>
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
