import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { Db } from "@outpost/db";
import { validate } from "../middleware/validate.js";
import { assertSpaceAccess, getActorInfo } from "./authz.js";
import { inboxDismissalService, logActivity } from "../services/index.js";

const ITEM_KEY_RE = /^(approval|join|run|attention):.+$/;

const inboxDismissalSchema = z.object({
  itemKey: z.string().trim().min(1).regex(ITEM_KEY_RE, "Unsupported inbox item key"),
  kind: z.enum(["dismiss", "snooze"]).default("dismiss"),
  snoozedUntil: z.string().trim().optional(),
}).superRefine((value, ctx) => {
  if (value.kind === "dismiss") {
    if (value.snoozedUntil != null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["snoozedUntil"], message: "Dismissals must not include snoozedUntil" });
    }
    return;
  }

  if (!value.snoozedUntil) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["snoozedUntil"], message: "Snooze requires snoozedUntil" });
    return;
  }
  const timestamp = new Date(value.snoozedUntil).getTime();
  if (!Number.isFinite(timestamp)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["snoozedUntil"], message: "snoozedUntil must be an ISO timestamp" });
    return;
  }
  if (timestamp <= Date.now()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["snoozedUntil"], message: "snoozedUntil must be in the future" });
  }
});

function requireOperatorUser(req: Request, res: Response) {
  if (req.actor.type !== "operator") {
    res.status(403).json({ error: "Operator authentication required" });
    return null;
  }
  if (!req.actor.userId) {
    res.status(403).json({ error: "Operator user context required" });
    return null;
  }
  return req.actor.userId;
}

export function inboxDismissalRoutes(db: Db) {
  const router = Router();
  const svc = inboxDismissalService(db);

  router.get("/spaces/:spaceId/inbox-dismissals", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const userId = requireOperatorUser(req, res);
    if (!userId) return;

    const dismissals = await svc.list(spaceId, userId);
    res.json(dismissals);
  });

  router.post(
    "/spaces/:spaceId/inbox-dismissals",
    validate(inboxDismissalSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      assertSpaceAccess(req, spaceId);
      const userId = requireOperatorUser(req, res);
      if (!userId) return;

      const dismissal = req.body.kind === "snooze"
        ? await svc.snooze(spaceId, userId, req.body.itemKey, new Date(req.body.snoozedUntil))
        : await svc.dismiss(spaceId, userId, req.body.itemKey, new Date());
      const actor = getActorInfo(req);
      await logActivity(db, {
        spaceId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: dismissal.kind === "snooze" ? "inbox.snoozed" : "inbox.dismissed",
        entityType: "space",
        entityId: spaceId,
        details: {
          userId,
          itemKey: dismissal.itemKey,
          kind: dismissal.kind,
          dismissedAt: dismissal.dismissedAt,
          snoozedUntil: dismissal.snoozedUntil,
        },
      });

      res.status(201).json(dismissal);
    },
  );

  router.delete("/spaces/:spaceId/inbox-dismissals/:itemKey", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const userId = requireOperatorUser(req, res);
    if (!userId) return;

    const itemKey = req.params.itemKey as string;
    if (!ITEM_KEY_RE.test(itemKey)) {
      res.status(400).json({ error: "Unsupported inbox item key" });
      return;
    }

    const restored = await svc.restore(spaceId, userId, itemKey);
    if (restored) {
      const actor = getActorInfo(req);
      await logActivity(db, {
        spaceId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        agentApiKeyId: actor.agentApiKeyId,
        action: "inbox.restored",
        entityType: "space",
        entityId: spaceId,
        details: {
          userId,
          itemKey: restored.itemKey,
          kind: restored.kind,
          dismissedAt: restored.dismissedAt,
          snoozedUntil: restored.snoozedUntil,
        },
      });
    }

    res.status(204).send();
  });

  return router;
}
