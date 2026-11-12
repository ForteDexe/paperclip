import {
  useHostNavigation,
  usePluginAction,
  usePluginData,
  usePluginStream,
  type PluginPageProps,
  type PluginSidebarProps,
} from "@paperclipai/plugin-sdk/ui";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

type Room = {
  id: string;
  company_id: string;
  project_id: string | null;
  name: string;
  created_at: string;
  updated_at: string;
};

type Member = {
  room_id: string;
  agent_id: string;
  handle: string;
  joined_at: string;
  name: string;
  status: string;
  adapter_type: string;
  session_id: string | null;
};

type Message = {
  id: string;
  seq: string | number;
  room_id: string;
  author_kind: "human" | "agent" | "system";
  author_agent_id: string | null;
  author_name: string | null;
  author_handle: string | null;
  body: string;
  created_at: string;
};

type AgentOption = {
  id: string;
  name: string;
  status: string;
  adapterType: string;
  booking: { room_id: string; room_name: string } | null;
};

type RoomState = {
  rooms: Room[];
  room: Room | null;
  members: Member[];
  messages: Message[];
  agents: AgentOption[];
};

type RoomEvent = {
  type: "room.changed" | "agent.event";
  roomId: string;
  reason?: string;
  agentId?: string;
  eventType?: "chunk" | "status" | "done" | "error";
};

function FlameIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22c4.4 0 7-3.1 7-7.1 0-3.1-1.8-5.8-5.1-8.5.1 2.1-.7 3.7-2.2 4.7.1-3.7-1.5-6.5-4.4-9.1.1 4.2-2.3 6.1-2.3 10.4C5 18 8 22 12 22Z" />
      <path d="M9.3 17.3c0 2 1.1 3.7 2.8 3.7 1.9 0 3-1.5 3-3.4 0-1.3-.7-2.5-2-3.6 0 1-.4 1.8-1.1 2.3-.1-1.5-.8-2.8-2-3.8.1 1.9-.7 3-0.7 4.8Z" />
    </svg>
  );
}

export function CampfireSidebarLink({ context }: PluginSidebarProps) {
  const navigation = useHostNavigation();
  if (!context.companyId) return null;
  return (
    <a
      {...navigation.linkProps("/campfire")}
      className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-foreground/80 transition-colors hover:bg-accent/50 hover:text-foreground"
      style={{ textDecoration: "none" }}
    >
      <span className="shrink-0"><FlameIcon /></span>
      <span className="flex-1 truncate">Campfire</span>
    </a>
  );
}

export function CampfirePage({ context }: PluginPageProps) {
  const companyId = context.companyId;
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [newRoomName, setNewRoomName] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thinking, setThinking] = useState<Set<string>>(() => new Set());
  const feedRef = useRef<HTMLDivElement | null>(null);
  const wasAtBottom = useRef(true);
  const createRoom = usePluginAction("create-room");
  const addMember = usePluginAction("add-member");
  const removeMember = usePluginAction("remove-member");
  const sendMessage = usePluginAction("send-message");
  const state = usePluginData<RoomState>("room-state", {
    companyId,
    roomId: selectedRoomId ?? undefined,
  });
  const stream = usePluginStream<RoomEvent>("campfire:rooms", {
    companyId: companyId ?? undefined,
  });

  useEffect(() => {
    if (!selectedRoomId && state.data?.room) setSelectedRoomId(state.data.room.id);
  }, [selectedRoomId, state.data?.room]);

  useEffect(() => {
    const event = stream.lastEvent;
    if (!event) return;
    if (event.type === "agent.event" && event.agentId) {
      setThinking((current) => {
        const next = new Set(current);
        if (event.eventType === "done" || event.eventType === "error") next.delete(event.agentId!);
        else next.add(event.agentId!);
        return next;
      });
    }
    if (event.roomId === selectedRoomId) state.refresh();
  }, [stream.lastEvent]);

  useEffect(() => {
    const feed = feedRef.current;
    if (feed && wasAtBottom.current) feed.scrollTop = feed.scrollHeight;
  }, [state.data?.messages.length]);

  const availableAgents = useMemo(
    () => (state.data?.agents ?? []).filter((agent) => agent.booking?.room_id !== state.data?.room?.id),
    [state.data?.agents, state.data?.room?.id],
  );

  async function perform(key: string, operation: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      return await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function submitRoom(event: FormEvent) {
    event.preventDefault();
    const name = newRoomName.trim();
    if (!companyId || !name) return;
    const result = await perform("create-room", () => createRoom({
      companyId,
      name,
      projectId: context.projectId ?? undefined,
    })) as { roomId?: string } | null;
    if (result?.roomId) {
      setNewRoomName("");
      setSelectedRoomId(result.roomId);
      state.refresh();
    }
  }

  async function invite(agent: AgentOption) {
    const roomId = state.data?.room?.id;
    if (!companyId || !roomId) return;
    await perform(`add:${agent.id}`, () => addMember({ companyId, roomId, agentId: agent.id }));
    state.refresh();
  }

  async function remove(member: Member) {
    const roomId = state.data?.room?.id;
    if (!companyId || !roomId) return;
    await perform(`remove:${member.agent_id}`, () => removeMember({
      companyId,
      roomId,
      agentId: member.agent_id,
    }));
    state.refresh();
  }

  async function submitMessage(event: FormEvent) {
    event.preventDefault();
    const roomId = state.data?.room?.id;
    const body = draft.trim();
    if (!companyId || !roomId || !body) return;
    const result = await perform("send", () => sendMessage({ companyId, roomId, body }));
    if (result) {
      setDraft("");
      wasAtBottom.current = true;
      state.refresh();
    }
  }

  if (!companyId) {
    return <main className="p-6 text-muted-foreground">Choose a company to open Campfire.</main>;
  }

  return (
    <main className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="rounded-md bg-muted p-2 text-foreground"><FlameIcon /></span>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold">{state.data?.room?.name ?? "Campfire"}</h1>
            <p className="text-sm text-muted-foreground">
              {state.data?.members.length ?? 0} at the fire · persistent agent sessions
            </p>
          </div>
        </div>
        <button type="button" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent" onClick={() => state.refresh()}>
          Refresh
        </button>
      </header>

      <section className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3" aria-label="Campfire rooms">
        {state.data?.rooms.map((room) => (
          <button
            key={room.id}
            type="button"
            className={room.id === state.data?.room?.id
              ? "rounded-full border border-primary bg-primary px-3 py-1.5 text-sm text-primary-foreground"
              : "rounded-full border border-border px-3 py-1.5 text-sm hover:bg-accent"}
            onClick={() => setSelectedRoomId(room.id)}
          >
            # {room.name}
          </button>
        ))}
        <form className="flex items-center gap-2" onSubmit={submitRoom}>
          <input
            className="min-w-40 rounded-md border border-input bg-background px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            value={newRoomName}
            onChange={(event) => setNewRoomName(event.target.value)}
            placeholder="New room name"
            aria-label="New room name"
          />
          <button className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50" disabled={!newRoomName.trim() || busy === "create-room"}>
            {busy === "create-room" ? "Creating…" : "Create"}
          </button>
        </form>
      </section>

      {error ? <div role="alert" className="border-b border-destructive bg-destructive/10 px-6 py-2 text-sm text-destructive">{error}</div> : null}

      {state.loading && !state.data ? <div className="p-6 text-muted-foreground">Loading Campfire…</div> : null}
      {state.error ? <div className="p-6 text-destructive">Campfire failed to load: {state.error.message}</div> : null}

      {state.data?.room ? (
        <>
          <section className="border-b border-border px-6 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">At the fire</span>
              {state.data.members.map((member) => (
                <span key={member.agent_id} className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1.5 text-sm">
                  <span className={thinking.has(member.agent_id) ? "animate-pulse text-primary" : "text-muted-foreground"} aria-hidden="true">
                    {thinking.has(member.agent_id) ? "∴" : "○"}
                  </span>
                  <strong>@{member.handle}</strong>
                  <span className="text-muted-foreground">{member.name}</span>
                  {member.session_id ? <span title="Persistent session active" className="text-primary">●</span> : null}
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                    aria-label={`Remove ${member.name}`}
                    disabled={busy === `remove:${member.agent_id}`}
                    onClick={() => void remove(member)}
                  >
                    ×
                  </button>
                </span>
              ))}
              {state.data.members.length === 0 ? <span className="text-sm text-muted-foreground">Invite an agent to begin.</span> : null}
            </div>
            {availableAgents.length > 0 ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-muted-foreground">Invite Outpost agent</summary>
                <div className="mt-2 flex flex-wrap gap-2">
                  {availableAgents.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      className="rounded-md border border-dashed border-border px-3 py-1.5 text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={Boolean(agent.booking) || busy === `add:${agent.id}`}
                      title={agent.booking ? `Booked in #${agent.booking.room_name}` : `Invite ${agent.name}`}
                      onClick={() => void invite(agent)}
                    >
                      + {agent.name}{agent.booking ? ` · #${agent.booking.room_name}` : ""}
                    </button>
                  ))}
                </div>
              </details>
            ) : null}
          </section>

          <div
            ref={feedRef}
            className="min-h-0 flex-1 overflow-y-auto px-6 py-5"
            onScroll={(event) => {
              const element = event.currentTarget;
              wasAtBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 32;
            }}
          >
            <div className="mx-auto flex max-w-5xl flex-col gap-4">
              {state.data.messages.map((message) => <MessageCard key={message.id} message={message} />)}
              {state.data.messages.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
                  The fire is ready. Send the first message when your agents have joined.
                </div>
              ) : null}
            </div>
          </div>

          <form className="border-t border-border px-6 py-4" onSubmit={submitMessage}>
            <div className="mx-auto flex max-w-5xl gap-3">
              <textarea
                className="min-h-24 flex-1 resize-y rounded-lg border border-input bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Message everyone, or use @handle for specific agents…"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <button
                className="self-end rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                disabled={!draft.trim() || busy === "send"}
              >
                {busy === "send" ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        </>
      ) : (
        <section className="flex flex-1 items-center justify-center p-8 text-center">
          <div className="max-w-md">
            <FlameIcon />
            <h2 className="mt-4 text-lg font-semibold">Create the first Campfire room</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Rooms are not created automatically. Name one for the development scope its agents will own.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}

function MessageCard({ message }: { message: Message }) {
  if (message.author_kind === "system") {
    return (
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        <em>{message.body}</em>
        <time>{formatTime(message.created_at)}</time>
        <span className="h-px flex-1 bg-border" />
      </div>
    );
  }
  const human = message.author_kind === "human";
  return (
    <article className={human
      ? "ml-auto max-w-3xl rounded-xl border border-primary/40 bg-primary/10 px-4 py-3"
      : "max-w-4xl rounded-xl border border-border bg-card px-4 py-3"}
    >
      <header className="mb-2 flex items-center gap-2 text-xs">
        <strong>{human ? "You" : message.author_name ?? "Agent"}</strong>
        {!human && message.author_handle ? <span className="text-primary">@{message.author_handle}</span> : null}
        <time className="text-muted-foreground">{formatTime(message.created_at)}</time>
      </header>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.body}</p>
    </article>
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
