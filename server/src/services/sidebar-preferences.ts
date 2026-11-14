import { and, eq } from "drizzle-orm";
import type { Db } from "@outpost/db";
import {
  spaceUserSidebarPreferences,
  userSidebarPreferences,
} from "@outpost/db";
import type { SidebarOrderPreference } from "@outpost/shared";

function normalizeOrderedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const orderedIds: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    orderedIds.push(trimmed);
  }
  return orderedIds;
}

function toPreference(orderedIds: unknown, updatedAt: Date | null): SidebarOrderPreference {
  return {
    orderedIds: normalizeOrderedIds(orderedIds),
    updatedAt,
  };
}

export function sidebarPreferenceService(db: Db) {
  return {
    async getSpaceOrder(userId: string): Promise<SidebarOrderPreference> {
      const row = await db.query.userSidebarPreferences.findFirst({
        where: eq(userSidebarPreferences.userId, userId),
      });
      return toPreference(row?.spaceOrder ?? [], row?.updatedAt ?? null);
    },

    async upsertSpaceOrder(userId: string, orderedIds: string[]): Promise<SidebarOrderPreference> {
      const now = new Date();
      const normalized = normalizeOrderedIds(orderedIds);
      const [row] = await db
        .insert(userSidebarPreferences)
        .values({
          userId,
          spaceOrder: normalized,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [userSidebarPreferences.userId],
          set: {
            spaceOrder: normalized,
            updatedAt: now,
          },
        })
        .returning();
      return toPreference(row?.spaceOrder ?? normalized, row?.updatedAt ?? now);
    },

    async getProjectOrder(spaceId: string, userId: string): Promise<SidebarOrderPreference> {
      const row = await db.query.spaceUserSidebarPreferences.findFirst({
        where: and(
          eq(spaceUserSidebarPreferences.spaceId, spaceId),
          eq(spaceUserSidebarPreferences.userId, userId),
        ),
      });
      return toPreference(row?.projectOrder ?? [], row?.updatedAt ?? null);
    },

    async upsertProjectOrder(
      spaceId: string,
      userId: string,
      orderedIds: string[],
    ): Promise<SidebarOrderPreference> {
      const now = new Date();
      const normalized = normalizeOrderedIds(orderedIds);
      const [row] = await db
        .insert(spaceUserSidebarPreferences)
        .values({
          spaceId,
          userId,
          projectOrder: normalized,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [spaceUserSidebarPreferences.spaceId, spaceUserSidebarPreferences.userId],
          set: {
            projectOrder: normalized,
            updatedAt: now,
          },
        })
        .returning();
      return toPreference(row?.projectOrder ?? normalized, row?.updatedAt ?? now);
    },
  };
}
