import { AGENT_ROLES, type AgentRole } from "@outpost/shared";

export interface MuseInvitationDraft { name: string; role: AgentRole }
export const emptyMuseInvitationDraft: MuseInvitationDraft = { name: "", role: "general" };

function key(spaceId: string, operatorId: string) {
  return `outpost.muse-invitation.${encodeURIComponent(spaceId)}.${encodeURIComponent(operatorId)}`;
}

/** Only the name and role survive navigation. Pairing capabilities never enter storage. */
export function readMuseInvitationDraft(spaceId: string, operatorId: string | null): MuseInvitationDraft {
  if (!operatorId) return { ...emptyMuseInvitationDraft };
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key(spaceId, operatorId)) ?? "null");
    if (typeof value === "object" && value !== null && "name" in value && "role" in value
      && typeof value.name === "string" && value.name.length <= 100
      && AGENT_ROLES.some(role => role === value.role)) {
      return { name: value.name, role: AGENT_ROLES.find(role => role === value.role)! };
    }
  } catch { /* Storage is optional; the mounted draft remains usable. */ }
  return { ...emptyMuseInvitationDraft };
}

export function saveMuseInvitationDraft(spaceId: string, operatorId: string | null, draft: MuseInvitationDraft) {
  if (!operatorId) return;
  try { localStorage.setItem(key(spaceId, operatorId), JSON.stringify({ name: draft.name, role: draft.role })); }
  catch { /* Storage is optional. */ }
}

export function clearMuseInvitationDraft(spaceId: string, operatorId: string | null) {
  if (!operatorId) return;
  try { localStorage.removeItem(key(spaceId, operatorId)); } catch { /* Storage is optional. */ }
}
