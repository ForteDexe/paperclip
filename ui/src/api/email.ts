import { api } from "./client";
import type {
  EmailConnectionInput,
  EmailCredentialOption,
  ToolConnection,
  EmailEndpointSummary,
  EmailPublicationSummary,
  EmailThreadSummary,
  EmailSendInput,
  EmailEndpointSetupInput,
  EmailAddressCheckInput,
  EmailAddressCheckResult,
} from "@outpost/shared";
export const emailApi = {
  credentials: (spaceId: string) => api.get<EmailCredentialOption[]>(`/spaces/${spaceId}/email/connections`),
  checkAddress: (spaceId: string, connectionId: string, input: EmailAddressCheckInput, signal?: AbortSignal) =>
    api.post<EmailAddressCheckResult>(
      `/spaces/${spaceId}/email/connections/${connectionId}/check-address`, input, { signal },
    ),
  connect: (spaceId: string, input: EmailConnectionInput) =>
    api.post<ToolConnection>(
      `/spaces/${spaceId}/email/connections`,
      input,
    ),
  inspectSaved: (spaceId: string, connectionId: string) =>
    api.post<{
      scope: { scope_type: string };
      inboxes: { inbox_id: string }[];
      domains: { domain_id: string; domain: string; status: string }[];
    }>(`/spaces/${spaceId}/email/connections/${connectionId}/inspect`, {}),
  list: (spaceId: string) =>
    api.get<EmailEndpointSummary[]>(`/spaces/${spaceId}/email/inboxes`),
  setup: (spaceId: string, input: EmailEndpointSetupInput) =>
    api.post<EmailEndpointSummary>(
      `/spaces/${spaceId}/email/inboxes`,
      input,
    ),
  inspect: (spaceId: string, apiKey: string) =>
    api.post<{
      scope: { scope_type: string };
      inboxes: { inbox_id: string }[];
      domains: { domain_id: string; domain: string; status: string }[];
    }>(`/spaces/${spaceId}/email/inspect`, { apiKey }),
  control: (id: string, action: "pause" | "resume" | "remove") =>
    api.post<EmailEndpointSummary>(`/email/inboxes/${id}/control`, { action }),
  reconnect: (
    id: string,
    apiKey: string,
    receiveMode: "websocket" | "webhook",
  ) =>
    api.post<EmailEndpointSummary>(`/email/inboxes/${id}/reconnect`, {
      apiKey,
      receiveMode,
    }),
  resolve: (
    spaceId: string,
    id: string,
    outcome: "sent" | "failed",
    providerMessageId?: string,
  ) =>
    api.post<EmailPublicationSummary>(
      `/spaces/${spaceId}/email/deliveries/${id}/resolve`,
      { outcome, providerMessageId },
    ),
  thread: (spaceId: string, issueId: string) =>
    api.get<EmailThreadSummary | null>(
      `/spaces/${spaceId}/email/tasks/${issueId}`,
    ),
  send: (spaceId: string, input: EmailSendInput) =>
    api.post<EmailPublicationSummary>(
      `/spaces/${spaceId}/email/send`,
      input,
    ),
};
