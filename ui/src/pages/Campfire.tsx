import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, Copy, Flame, Plus } from "lucide-react";
import { campfireApi, type CampfireDelivery } from "@/api/campfire";
import { AgentAvatar } from "@/components/AgentAvatar";
import { MarkdownBody } from "@/components/MarkdownBody";
import { Button } from "@/components/ui/button";
import { ConversationAlertBanner, useDismissedConversationAlerts } from "@/components/ConversationAlertBanner";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useSpace } from "@/context/SpaceContext";
import { queryKeys } from "@/lib/queryKeys";
import { useNavigate, useParams } from "@/lib/router";
import { cn } from "@/lib/utils";

function mentionQuery(value: string, caret: number) {
  const before = value.slice(0, caret);
  const match = /(?:^|\s)@([A-Za-z0-9_-]*)$/.exec(before);
  return match ? match[1]!.toLowerCase() : null;
}

function messageTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function deliveryFailure(delivery: CampfireDelivery) {
  const error = delivery.runError?.trim() || delivery.error?.trim() || "The agent run failed.";
  if (error.includes("Selected model is at capacity")) {
    return "Selected model is at capacity. Please try a different model.";
  }
  return error;
}

export function Campfire() {
  const { selectedSpaceId } = useSpace();
  const { roomId } = useParams<{ roomId?: string }>();
  const navigate = useNavigate();
  const { setBreadcrumbs } = useBreadcrumbs();
  const client = useQueryClient();
  const [draft, setDraft] = useState("");
  const [caret, setCaret] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const wasAtBottom = useRef(true);
  const state = useQuery({
    queryKey: queryKeys.campfire.state(selectedSpaceId, roomId),
    queryFn: () => campfireApi.state(selectedSpaceId!, roomId),
    enabled: !!selectedSpaceId,
    refetchInterval: 1_500,
    refetchIntervalInBackground: false,
  });
  const alertScope = `campfire:${selectedSpaceId ?? "none"}:${roomId ?? state.data?.room?.id ?? "none"}`;
  const { dismissedIds: dismissedDeliveryIds, dismiss: dismissDeliveryIds } = useDismissedConversationAlerts(alertScope);
  useEffect(() => setBreadcrumbs([{ label: "Campfire" }]), [setBreadcrumbs]);
  useEffect(() => {
    if (!roomId && state.data?.room) navigate(`/campfire/${state.data.room.id}`, { replace: true });
  }, [navigate, roomId, state.data?.room?.id]);
  useEffect(() => {
    const node = scroller.current;
    if (node && wasAtBottom.current) node.scrollTop = node.scrollHeight;
  }, [state.data?.messages.length]);
  const send = useMutation({
    mutationFn: () => campfireApi.sendMessage(selectedSpaceId!, state.data!.room!.id, draft),
    onSuccess: async () => {
      setDraft("");
      wasAtBottom.current = true;
      await client.invalidateQueries({ queryKey: queryKeys.campfire.all(selectedSpaceId) });
    },
  });
  const query = mentionQuery(draft, caret);
  const suggestions = useMemo(() => query === null ? [] : (state.data?.members ?? []).filter((member) => member.handle.toLowerCase().includes(query)).slice(0, 6), [query, state.data?.members]);
  const visibleDeliveryFailure = useMemo(() => (state.data?.deliveries ?? [])
    .filter((delivery) => delivery.status === "failed" && !dismissedDeliveryIds.has(delivery.id))
    .at(-1) ?? null, [dismissedDeliveryIds, state.data?.deliveries]);
  const dismissCurrentDeliveryFailures = () => dismissDeliveryIds(
    (state.data?.deliveries ?? []).filter((delivery) => delivery.status === "failed").map((delivery) => delivery.id),
  );
  const selectMention = (handle: string) => {
    const before = draft.slice(0, caret).replace(/@([A-Za-z0-9_-]*)$/, `@${handle} `);
    setDraft(before + draft.slice(caret));
    setCaret(before.length);
  };
  if (state.isPending) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading Campfire…</div>;
  if (state.isError) return <div className="flex h-full items-center justify-center text-sm text-destructive">Couldn’t load Campfire.</div>;
  const room = state.data?.room;
  if (!room) return <div className="flex h-full flex-col items-center justify-center gap-3 text-center"><span className="flex size-12 items-center justify-center rounded-xl bg-muted"><Flame className="size-6" /></span><h1 className="text-lg font-semibold">Create your first Campfire room</h1><p className="max-w-sm text-sm text-muted-foreground">Use the room list to create a persistent group conversation for agents in this Space.</p></div>;
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={`Campfire room ${room.name}`}>
      {send.isError ? (
        <ConversationAlertBanner
          title="Couldn’t send message"
          detail={send.error instanceof Error ? send.error.message : "Please try again."}
          onDismiss={() => send.reset()}
        />
      ) : visibleDeliveryFailure ? (
        <ConversationAlertBanner
          title={`${visibleDeliveryFailure.agentName} couldn’t answer`}
          detail={deliveryFailure(visibleDeliveryFailure)}
          onDismiss={dismissCurrentDeliveryFailures}
        />
      ) : null}
      <div ref={scroller} data-testid="campfire-scroller" onScroll={(event) => { const node = event.currentTarget; wasAtBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48; }} className="min-h-0 flex-1 overflow-y-auto px-5 py-8 scrollbar-auto-hide">
        {state.data.messages.length ? <div className="mx-auto flex w-full max-w-(--tc-shell-max-w) flex-col gap-6">{state.data.messages.map((message) => message.authorKind === "system" ? (
          <div key={message.id} className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" /><span className="text-center italic">{message.body}</span><span className="h-px flex-1 bg-border" /></div>
        ) : message.authorKind === "human" ? (
          <article key={message.id} className="flex w-full flex-col items-end gap-1">
            <div className="max-w-(--pct-85) break-words rounded-2xl rounded-br-sm bg-(--liveness-blue) px-3.5 py-2 text-sm text-white">
              <MarkdownBody className="outpost-markdown-on-accent">{message.body}</MarkdownBody>
            </div>
            <time className="px-1 text-(length:--text-micro) text-muted-foreground">{messageTime(message.createdAt)}</time>
          </article>
        ) : (
          <article key={message.id} className="flex w-full flex-col items-start gap-1">
            <div className="flex items-center gap-2 px-1">
              <AgentAvatar agent={{ id: message.authorAgentId ?? undefined, name: message.authorName ?? "Agent" }} name={message.authorName ?? "Agent"} size={24} />
              <span className="text-sm font-semibold text-foreground">{message.authorName ?? "Agent"}</span>
            </div>
            <div className="w-full break-words bg-transparent px-1 py-2 text-sm text-foreground">
              <MarkdownBody softBreaks>{message.body}</MarkdownBody>
            </div>
            <div className="flex w-full items-center justify-between gap-2 px-1">
              <time className="text-(length:--text-micro) text-muted-foreground">{messageTime(message.createdAt)}</time>
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Copy message" onClick={() => void navigator.clipboard.writeText(message.body)}>
                <Copy className="size-3.5" />
              </Button>
            </div>
          </article>
        ))}</div> : <p className="text-center text-sm text-muted-foreground">No messages yet.</p>}
      </div>
      <form className="task-chat-composer-dock relative mx-auto flex w-full max-w-(--tc-shell-max-w) shrink-0 flex-col gap-2 pb-1 md:pb-0" onSubmit={(event) => { event.preventDefault(); if (draft.trim() && !send.isPending) send.mutate(); }}>
        {query !== null && suggestions.length ? <div className="absolute bottom-[calc(100%+.5rem)] left-0 z-20 w-72 rounded-lg border border-border bg-popover p-1 shadow-lg">{suggestions.map((member) => <button key={member.agentId} type="button" onClick={() => selectMention(member.handle)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-accent"><span className="font-medium">@{member.handle}</span><span className="truncate text-xs text-muted-foreground">{member.name}</span></button>)}</div> : null}
        <div className="outpost-task-chat-composer flex min-h-[126px] flex-col rounded-(--radius-task-composer) border border-border bg-card p-(--sz-18px) shadow-(--shadow-task-composer) focus-within:ring-2 focus-within:ring-ring dark:border-0 dark:bg-muted dark:shadow-none">
          <textarea aria-label="Campfire message" placeholder="Message everyone — use @handle for a specific agent…" value={draft} onChange={(event) => { setDraft(event.target.value); setCaret(event.target.selectionStart); }} onClick={(event) => setCaret(event.currentTarget.selectionStart)} onKeyUp={(event) => setCaret(event.currentTarget.selectionStart)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (draft.trim() && !send.isPending) send.mutate(); } }} className="min-h-12 w-full flex-1 resize-none bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground" />
          <div className="mt-1.5 flex items-center justify-between">
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Add attachment"><Plus className="size-4" /></Button>
            <Button type="submit" size="icon-sm" aria-label="Send message" disabled={!draft.trim() || send.isPending || !state.data.members.length} className="rounded-full"><ArrowUp className="size-4" /></Button>
          </div>
        </div>
      </form>
    </section>
  );
}
