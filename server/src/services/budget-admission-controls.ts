import { and, eq } from "drizzle-orm";
import { spaces, projects, type Db } from "@outpost/db";
import { notFound } from "../errors.js";

/** Shared execution-authority fences allow concurrent admissions. Acquire
 * before feature/agent/run locks; they exclude manual pause/delete until this
 * admission commits. Settlements and eligibility-only reads never call this. */
export async function lockBudgetAdmissionControls(tx: Db, spaceId: string, projectId?: string | null) {
  const [space] = await tx.select({ id: spaces.id }).from(spaces).where(eq(spaces.id, spaceId)).for("share");
  if (!space) throw notFound("Outpost not found");
  if (projectId) {
    const [project] = await tx.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.spaceId, spaceId))).for("share");
    if (!project) throw notFound("Budget project not found");
  }
}
