import { api } from "./client";

export interface CampfireRoom {
  id: string;
  spaceId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface CampfireMember {
  roomId: string;
  agentId: string;
  handle: string;
  joinedAt: string;
  name: string;
  status: string;
  adapterType: string;
  sessionId: string | null;
}

export interface CampfireMessage {
  id: string;
  seq: number;
  roomId: string;
  authorKind: "human" | "agent" | "system";
  authorAgentId: string | null;
  authorName: string | null;
  authorHandle: string | null;
  body: string;
  createdAt: string;
}

export interface CampfireDelivery {
  id: string;
  messageId: string;
  agentId: string;
  agentName: string;
  agentHandle: string | null;
  status: string;
  runId: string | null;
  error: string | null;
  runError: string | null;
  errorCode: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface CampfireAgent {
  id: string;
  name: string;
  status: string;
  adapterType: string;
  booking: { agentId: string; roomId: string; roomName: string } | null;
}

export interface CampfireState {
  rooms: CampfireRoom[];
  room: CampfireRoom | null;
  members: CampfireMember[];
  messages: CampfireMessage[];
  deliveries: CampfireDelivery[];
  agents: CampfireAgent[];
}

export const campfireApi = {
  state: (spaceId: string, roomId?: string | null) => {
    const query = roomId ? `?roomId=${encodeURIComponent(roomId)}` : "";
    return api.get<CampfireState>(`/spaces/${spaceId}/campfire${query}`);
  },
  createRoom: (spaceId: string, name: string) =>
    api.post<CampfireRoom>(`/spaces/${spaceId}/campfire/rooms`, { name }),
  addMember: (spaceId: string, roomId: string, agentId: string, handle?: string) =>
    api.post<{ roomId: string; agentId: string; handle: string }>(
      `/spaces/${spaceId}/campfire/rooms/${roomId}/members`,
      { agentId, ...(handle ? { handle } : {}) },
    ),
  removeMember: (spaceId: string, roomId: string, agentId: string) =>
    api.delete<{ roomId: string; agentId: string }>(
      `/spaces/${spaceId}/campfire/rooms/${roomId}/members/${agentId}`,
    ),
  sendMessage: (spaceId: string, roomId: string, body: string) =>
    api.post<{ messageId: string; recipients: Array<{ agentId: string; handle: string }> }>(
      `/spaces/${spaceId}/campfire/rooms/${roomId}/messages`,
      { body },
    ),
};
