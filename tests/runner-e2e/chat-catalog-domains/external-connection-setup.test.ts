import { expect, it } from "vitest";
import type { ConnectionIntentInteraction } from "../../../packages/shared/src/types/issue.js";
import { addressedNotionRequest } from "./external-connection-setup.js";

it("binds the real CEO-needs-Notion card to its exact person/space/source before clicking Not now", () => {
  const target = { spaceId: "space", issueId: "source", agentId: "ceo", personId: "person" };
  const card = { kind: "connection_intent", spaceId: "space", issueId: "source", createdByAgentId: "ceo", sourceRunId: "run", addresseeUserId: "person", payload: { serviceSlug: "notion", serviceName: "Notion", requestingAgentId: "ceo", requestingAgentName: "CEO" } } as ConnectionIntentInteraction;
  expect(addressedNotionRequest(card, target)).toBe(true);
  for (const wrong of [
    { ...card, spaceId: "other" }, { ...card, issueId: "other" },
    { ...card, createdByAgentId: "other" }, { ...card, addresseeUserId: "other" },
    { ...card, sourceRunId: null }, { ...card, payload: { ...card.payload, serviceSlug: "linear" } },
    { ...card, payload: { ...card.payload, requestingAgentId: "other" } },
  ]) expect(addressedNotionRequest(wrong as ConnectionIntentInteraction, target)).toBe(false);
});
