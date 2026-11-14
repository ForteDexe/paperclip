import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { LinkPreviewResult, LinkPreviewTarget } from "@outpost/shared";
import { api } from "@/api/client";

export interface LinkPreviewContextValue {
  spaceId: string;
  userId: string | null;
  load: (target: LinkPreviewTarget) => Promise<LinkPreviewResult>;
}

const LinkPreviewContext = createContext<LinkPreviewContextValue | null>(null);

export function LinkPreviewProvider({ spaceId, userId, children }: {
  spaceId: string | null; userId: string | null; children: ReactNode;
}) {
  const value = useMemo<LinkPreviewContextValue | null>(() => spaceId ? ({
    spaceId, userId,
    load: target => api.get<LinkPreviewResult>(
      `/spaces/${spaceId}/link-preview?${new URLSearchParams({ url: target.canonicalUrl })}`,
      { timeoutMs: 6_000, cache: "no-store" },
    ),
  }) : null, [spaceId, userId]);
  return <LinkPreviewContext.Provider value={value}>{children}</LinkPreviewContext.Provider>;
}

export function useLinkPreviewContext() { return useContext(LinkPreviewContext); }
