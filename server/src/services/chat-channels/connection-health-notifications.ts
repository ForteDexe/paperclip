import type { ChatProvider } from "@outpost/shared";
import { notifyToolConnectionHealth } from "../tool-connection-health-notifications.js";
import { chatConnectionTransport } from "./provider-catalog.js";

export async function notifyChatConnectionHealth(transaction: object, endpoint: { spaceId: string; connectionId: string; provider: ChatProvider }) {
  if (chatConnectionTransport(endpoint.provider) === "chat_sdk") return;
  await notifyToolConnectionHealth(transaction, { spaceId: endpoint.spaceId, id: endpoint.connectionId });
}
