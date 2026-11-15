import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flame, Plus, Search, UserMinus, UserPlus, X } from "lucide-react";
import { campfireApi } from "@/api/campfire";
import { useSpace } from "@/context/SpaceContext";
import { queryKeys } from "@/lib/queryKeys";
import { Link, useNavigate, useParams } from "@/lib/router";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CampfireSidebar() {
  const { selectedSpaceId } = useSpace();
  const { roomId } = useParams<{ roomId?: string }>();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const state = useQuery({
    queryKey: queryKeys.campfire.state(selectedSpaceId, roomId),
    queryFn: () => campfireApi.state(selectedSpaceId!, roomId),
    enabled: !!selectedSpaceId,
  });
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: queryKeys.campfire.all(selectedSpaceId) });
  };
  const createRoom = useMutation({
    mutationFn: () => campfireApi.createRoom(selectedSpaceId!, name),
    onSuccess: async (room) => {
      setName("");
      setCreating(false);
      await refresh();
      navigate(`/campfire/${room.id}`);
    },
  });
  const addMember = useMutation({
    mutationFn: (agentId: string) => campfireApi.addMember(selectedSpaceId!, state.data!.room!.id, agentId),
    onSuccess: refresh,
  });
  const removeMember = useMutation({
    mutationFn: (agentId: string) => campfireApi.removeMember(selectedSpaceId!, state.data!.room!.id, agentId),
    onSuccess: refresh,
  });
  const query = search.trim().toLocaleLowerCase();
  const rooms = useMemo(
    () => (state.data?.rooms ?? []).filter((room) => room.name.toLocaleLowerCase().includes(query)),
    [query, state.data?.rooms],
  );
  const joinedIds = new Set((state.data?.members ?? []).map((member) => member.agentId));
  const available = (state.data?.agents ?? []).filter(
    (agent) => agent.status !== "terminated" && !joinedIds.has(agent.id) && !agent.booking,
  );
  return (
    <aside aria-label="Campfire rooms" className="flex h-full min-h-0 flex-col border-r border-border bg-background">
      <div className="flex shrink-0 items-center gap-2 px-3 pb-3 pt-5">
        <div className="relative min-w-0 flex-1">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search rooms" placeholder="Search rooms" value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 pl-8 pr-8 text-xs md:text-xs" />
          {search ? <Button variant="ghost" size="icon-xs" aria-label="Clear search" className="absolute right-1 top-1/2 -translate-y-1/2" onClick={() => setSearch("")}><X className="size-3" /></Button> : null}
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3 scrollbar-auto-hide">
        {state.isPending ? <p className="px-2 py-3 text-xs text-muted-foreground">Loading rooms…</p> : state.isError ? <p role="alert" className="px-2 py-3 text-xs text-destructive">Couldn’t load Campfire.</p> : (
          <>
            <nav aria-label="Campfire rooms" className="flex flex-col gap-1">
              {rooms.map((room) => (
                <Link key={room.id} to={`/campfire/${room.id}`} aria-current={state.data?.room?.id === room.id ? "page" : undefined}
                  className={cn("flex min-w-0 items-center gap-3 rounded-md px-2.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", state.data?.room?.id === room.id ? "bg-accent text-accent-foreground" : "hover:bg-accent/60")}>
                  <span className="flex size-10 shrink-0 items-center justify-center"><span className="flex size-8 items-center justify-center rounded-lg bg-muted"><Flame className="size-4" /></span></span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="truncate text-sm font-medium"># {room.name}</span><span className="truncate text-xs text-muted-foreground">{state.data?.room?.id === room.id ? `${state.data.members.length} at the fire` : "Campfire room"}</span></span>
                </Link>
              ))}
            </nav>
            {creating ? (
              <form className="flex gap-2 px-2 py-2" onSubmit={(event) => { event.preventDefault(); if (name.trim()) createRoom.mutate(); }}>
                <Input autoFocus aria-label="New room name" placeholder="Room name" value={name} onChange={(event) => setName(event.target.value)} className="h-9" />
                <Button type="submit" size="sm" disabled={!name.trim() || createRoom.isPending}>Create</Button>
              </form>
            ) : (
              <button type="button" onClick={() => setCreating(true)} className="flex min-w-0 items-center gap-3 rounded-md px-2.5 py-3 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <span aria-hidden className="flex size-10 shrink-0 items-center justify-center"><span className="flex size-8 items-center justify-center rounded-lg bg-muted"><Plus className="size-5" /></span></span>
                <span className="text-sm font-medium">Create a new room</span>
              </button>
            )}
            {state.data?.room ? <div className="mt-3 border-t border-border pt-4">
              <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">At the fire · {state.data.members.length}</p>
              <div className="mt-2 flex flex-col gap-1">
                {state.data.members.map((member) => <div key={member.agentId} className="group flex items-center gap-2 rounded-md px-2 py-2 hover:bg-accent/60">
                  <span className="size-2 rounded-full bg-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm"><span className="font-medium">@{member.handle}</span><span className="ml-2 text-xs text-muted-foreground">{member.name}</span></span>
                  <Button variant="ghost" size="icon-xs" aria-label={`Remove ${member.name}`} disabled={removeMember.isPending} onClick={() => removeMember.mutate(member.agentId)}><UserMinus className="size-3.5" /></Button>
                </div>)}
                {!state.data.members.length ? <p className="px-2 py-1 text-xs text-muted-foreground">No agents joined yet.</p> : null}
              </div>
              {available.length ? <div className="mt-3">
                <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Invite agent</p>
                <div className="mt-1 flex flex-col gap-1">{available.map((agent) => <button key={agent.id} type="button" disabled={addMember.isPending} onClick={() => addMember.mutate(agent.id)} className="flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent/60 disabled:opacity-50"><UserPlus className="size-3.5 text-muted-foreground" /><span className="truncate">{agent.name}</span></button>)}</div>
              </div> : null}
            </div> : null}
          </>
        )}
      </div>
    </aside>
  );
}
