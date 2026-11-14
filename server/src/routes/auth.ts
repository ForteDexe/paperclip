import { Router } from "express";
import { eq } from "drizzle-orm";
import type { Db } from "@outpost/db";
import { authUsers } from "@outpost/db";
import {
  authSessionSchema,
  currentUserProfileSchema,
} from "@outpost/shared";
import { unauthorized } from "../errors.js";
import { resolveSentryDsns } from "../sentry-dsn.js";
import { logger } from "../middleware/logger.js";
import { loadBoardBootstrap } from "../services/operator-bootstrap.js";

async function loadCurrentUserProfile(db: Db, userId: string) {
  const user = await db
    .select({
      id: authUsers.id,
      email: authUsers.email,
      name: authUsers.name,
      image: authUsers.image,
    })
    .from(authUsers)
    .where(eq(authUsers.id, userId))
    .then((rows) => rows[0] ?? null);

  if (!user) {
    throw unauthorized("Signed-in user not found");
  }

  return currentUserProfileSchema.parse({
    id: user.id,
    email: user.email ?? null,
    name: user.name ?? null,
    image: user.image ?? null,
  });
}

export function authRoutes(db: Db) {
  const router = Router();

  router.get("/get-session", async (req, res) => {
    if (req.actor.type !== "operator" || !req.actor.userId) {
      throw unauthorized("Operator authentication required");
    }

    const bootstrap = (req.actor.source === "session" || req.actor.source === "cloud_tenant")
      && Array.isArray(req.actor.spaceIds)
      ? loadBoardBootstrap(db, { userId: req.actor.userId, spaceIds: req.actor.spaceIds }).catch((err) => {
        logger.warn({ err }, "failed to load optional operator bootstrap");
        return undefined;
      })
      : Promise.resolve(undefined);
    const [user, operatorBootstrap] = await Promise.all([loadCurrentUserProfile(db, req.actor.userId), bootstrap]);
    res.setHeader("Cache-Control", "private, no-store");
    const session = authSessionSchema.parse({
      session: {
        id: `outpost:${req.actor.source ?? "none"}:${req.actor.userId}`,
        userId: req.actor.userId,
      },
      user,
      // The browser reads this value to open its own Sentry gate — see
      // `ui/src/lib/sentry.ts`. `req.actor.type` already gates this whole
      // handler, so no second authorization check runs here. This field
      // carries the front-end DSN only; it never carries the backend DSN.
      sentryDsn: resolveSentryDsns().frontend,
      // Match the server SDK's runtime environment, including in reused images.
      sentryEnvironment: process.env.SENTRY_ENVIRONMENT || null,
    });
    res.json({ ...session, ...(operatorBootstrap ? { operatorBootstrap } : {}) });
  });

  return router;
}
