// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { readMuseInvitationDraft, saveMuseInvitationDraft } from "./muse-invitation-draft";

afterEach(() => localStorage.clear());
it("retains only name and role in the exact space and operator scope", () => {
  const draft = { name: "Maia", role: "researcher" as const, ticket: "secret-not-to-save", setupInstruction: "private setup" };
  saveMuseInvitationDraft("space-a", "operator-a", draft);
  expect(readMuseInvitationDraft("space-a", "operator-a")).toEqual({ name: "Maia", role: "researcher" });
  expect(readMuseInvitationDraft("space-b", "operator-a").name).toBe("");
  expect(readMuseInvitationDraft("space-a", "operator-b").name).toBe("");
  expect(readMuseInvitationDraft("space-a", null).name).toBe("");
  expect(localStorage.getItem(localStorage.key(0)!)).not.toContain("secret-not-to-save");
  expect(localStorage.getItem(localStorage.key(0)!)).not.toContain("setupInstruction");
});
it("rejects a corrupt role and does not share a signed-out draft", () => {
  saveMuseInvitationDraft("space", null, { name: "Anonymous", role: "general" });
  expect(localStorage.length).toBe(0);
  localStorage.setItem("outpost.muse-invitation.space.operator", JSON.stringify({ name: "Maia", role: "invented" }));
  expect(readMuseInvitationDraft("space", "operator")).toEqual({ name: "", role: "general" });
});
