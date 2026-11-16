import { TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TaskChatItem } from "@/components/task-chat/task-chat-model";

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
