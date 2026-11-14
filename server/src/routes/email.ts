import { connectionManagementGuard, connectionRequestContext, connectionRequestUserId } from "./connection-management-authz.js";
import { Router, type ErrorRequestHandler, type Request } from "express";
import { z } from "zod";
import {
  emailConnectionSchema,
  emailAddressCheckSchema,
  emailEndpointSetupSchema,
  emailSendSchema,
  isUuidLike,
} from "@outpost/shared";
import type { Db } from "@outpost/db";
import { validate } from "../middleware/validate.js";
import { assertOperator, assertSpaceAccess, hasSpaceAccess } from "./authz.js";
import { emailConnectionService } from "../services/email-connections.js";
import { accessService } from "../services/access.js";
import { badRequest, forbidden, HttpError, notFound } from "../errors.js";
import { agentmailApi, AgentmailApiError } from "../services/agentmail-api.js";
import { logger } from "../middleware/logger.js";
import type {
  EmailChannelService,
  EmailActor,
} from "../services/email-channels.js";

function actor(req: Request): EmailActor {
  return req.actor.type === "agent"
    ? { agentId: req.actor.agentId, runId: req.actor.runId ?? undefined,
        ...(connectionRequestContext(req) ? { userId: connectionRequestUserId(req) ?? undefined, managementContext: connectionRequestContext(req) } : {}) }
    : {
        userId: req.actor.userId ?? "operator",
        localImplicit: req.actor.source === "local_implicit",
      };
}

// Provider rejections describe setup/account problems, not Outpost crashes.
// Only local messages and operation names reach the UI; never forward a body.
const agentmailErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (!(error instanceof AgentmailApiError)) return next(error);
  logger.warn({ operation: error.operation, providerStatus: error.status, providerCode: error.providerCode }, "AgentMail request rejected");
  const actions: Partial<Record<AgentmailApiError["operation"], string>> = {
    request: "complete this request",
    inspect_key: "verify the API key",
    create_inbox: "create the email address",
    create_inbox_key: "create an inbox-scoped API key",
    create_webhook: "register the email webhook",
  };
  const action = actions[error.operation] ?? "complete this request";
  let status = 422;
  let code = "agentmail_request_failed";
  let message: string;
  const addressTaken = error.operation === "create_inbox"
    && [403, 409, 422].includes(error.status)
    && (error.providerCode === "resource_taken" || error.providerCode === "already_exists");
  if (addressTaken) {
    status = 409;
    code = "agentmail_address_taken";
    message = "This email address is already in use. Choose a different address.";
  } else if (error.providerCode === "limit_exceeded") {
    message = "Your AgentMail account has reached its resource limit. Free up space or increase your plan’s limit, then try again.";
  } else if (error.providerCode === "domain_not_verified") {
    message = "Verify this domain in AgentMail before creating an email address, or choose another domain.";
  } else if (error.status === 401) {
    message = "AgentMail rejected the API key. Check that it is correct and has not been revoked, then reconnect.";
  } else if (error.status === 403) {
    message = `AgentMail did not allow Outpost to ${action}. Check your API key permissions and AgentMail account limits, then try again.`;
  } else if (error.status === 429) {
    status = 429;
    res.set("Retry-After", String(Math.ceil(error.retryAfterMs / 1000)));
    message = "AgentMail is rate limiting requests. Wait a moment, then try again.";
  } else if ([400, 409, 422].includes(error.status) && error.operation === "create_inbox") {
    message = "AgentMail could not create this email address. Try a different address and check that its domain is available in your AgentMail account.";
  } else if (error.status === 404) {
    message = error.operation === "create_inbox_key"
      ? "AgentMail could not create an access key for this inbox. The email address was saved; try finishing the connection again."
      : "AgentMail could not find the requested inbox or resource. Check that it still exists and that your API key can access it.";
  } else if (error.status >= 500) {
    status = 502;
    message = "AgentMail is temporarily unavailable. Try again in a moment.";
  } else {
    message = `AgentMail could not ${action}. Check your AgentMail settings, then try again.`;
  }
  next(new HttpError(status, message, {
    code,
    providerStatus: error.status,
    operation: error.operation,
    ...(addressTaken ? { field: "username" } : {}),
  }));
};

export function emailRoutes(db: Db, service: EmailChannelService) {
  const router = Router();
  const managementGuard = connectionManagementGuard(db, "chat");
  async function manager(req: Request, spaceId: string) {
    if (req.actor.type === "agent" && connectionRequestContext(req)) return;
    assertOperator(req);
    if (!hasSpaceAccess(req, spaceId))
      throw notFound("Email inbox not found");
    assertSpaceAccess(req, spaceId);
    if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin)
      return;
    if (
      !req.actor.userId ||
      !(await accessService(db).hasPermission(
        spaceId,
        "user",
        req.actor.userId,
        "tools:manage_connections",
      ))
    )
      throw forbidden("Missing permission: tools:manage_connections");
  }
  router.get("/spaces/:spaceId/email/connections", managementGuard("connections:read", "GET /spaces/:spaceId/email/connections", { personal: true }), async (req, res) => {
    const spaceId = req.params.spaceId as string;
    await manager(req, spaceId);
    res.set("Cache-Control", "no-store").json(
      await emailConnectionService(db).listCredentials(spaceId, actor(req)),
    );
  });
  router.post(
    "/spaces/:spaceId/email/connections", managementGuard("connections:configure", "POST /spaces/:spaceId/email/connections", { personal: true }),
    validate(emailConnectionSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      await manager(req, spaceId);
      res
        .status(201)
        .json(
          await emailConnectionService(db).connect(
            spaceId,
            req.body,
            actor(req),
          ),
        );
    },
  );
  router.post(
    "/spaces/:spaceId/email/connections/:connectionId/inspect", managementGuard("connections:configure", "POST /spaces/:spaceId/email/connections/:connectionId/inspect", { personal: true }),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      await manager(req, spaceId);
      const saved = await emailConnectionService(db).credential(
        spaceId,
        req.params.connectionId as string,
        actor(req),
      );
      res
        .set("Cache-Control", "no-store")
        .json(await service.inspect(saved.value));
    },
  );
  router.post(
    "/spaces/:spaceId/email/connections/:connectionId/check-address", managementGuard("connections:configure", "POST /spaces/:spaceId/email/connections/:connectionId/check-address", { personal: true }),
    validate(emailAddressCheckSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      await manager(req, spaceId);
      const saved = await emailConnectionService(db).credential(
        spaceId, req.params.connectionId as string, actor(req),
      );
      res.set("Cache-Control", "no-store").json(await agentmailApi(saved.value)
        .checkAddress(`${req.body.username}@${req.body.domain}`));
    },
  );
  router.get("/spaces/:spaceId/email/inboxes", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const rows = await service.list(spaceId);
    res.json(
      req.actor.type === "agent"
        ? rows.filter((r) => r.assignedAgentId === req.actor.agentId)
        : rows,
    );
  });
  router.post(
    "/spaces/:spaceId/email/inspect", managementGuard("connections:configure", "POST /spaces/:spaceId/email/inspect", { personal: true }),
    validate(z.object({ apiKey: z.string().min(1).max(4096) }).strict()),
    async (req, res) => {
      await manager(req, req.params.spaceId as string);
      res.set("Cache-Control", "no-store");
      res.json(await service.inspect(req.body.apiKey));
    },
  );
  router.post(
    "/spaces/:spaceId/email/inboxes", managementGuard("connections:configure", "POST /spaces/:spaceId/email/inboxes", { personal: true }),
    validate(emailEndpointSetupSchema),
    async (req, res) => {
      await manager(req, req.params.spaceId as string);
      res
        .status(201)
        .json(
          await service.setup(
            req.params.spaceId as string,
            req.body,
            actor(req),
          ),
        );
    },
  );
  router.post(
    "/email/inboxes/:endpointId/control", managementGuard("connections:configure", "POST /email/inboxes/:endpointId/control", { personal: true }),
    validate(
      z.object({ action: z.enum(["pause", "resume", "remove"]) }).strict(),
    ),
    async (req, res) => {
      const endpoint = await service.getEndpoint(
        req.params.endpointId as string,
      );
      await manager(req, endpoint.spaceId);
      res.json(await service.control(endpoint.id, req.body.action, actor(req)));
    },
  );
  router.post(
    "/email/inboxes/:endpointId/reconnect", managementGuard("connections:configure", "POST /email/inboxes/:endpointId/reconnect", { personal: true }),
    validate(
      z
        .object({
          apiKey: z.string().min(1).max(4096),
          receiveMode: z.enum(["websocket", "webhook"]),
        })
        .strict(),
    ),
    async (req, res) => {
      const endpoint = await service.getEndpoint(
        req.params.endpointId as string,
      );
      await manager(req, endpoint.spaceId);
      res.json(
        await service.reconnect(
          endpoint.id,
          req.body.apiKey,
          req.body.receiveMode,
          actor(req),
        ),
      );
    },
  );
  router.post(
    "/spaces/:spaceId/email/deliveries/:publicationId/resolve",
    validate(
      z
        .object({
          outcome: z.enum(["sent", "failed"]),
          providerMessageId: z.string().min(1).max(998).optional(),
        })
        .strict(),
    ),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      await manager(req, spaceId);
      res.json(
        await service.resolveUncertain(
          spaceId,
          req.params.publicationId as string,
          req.body,
          actor(req),
        ),
      );
    },
  );
  router.post(
    "/spaces/:spaceId/email/send",
    validate(emailSendSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      assertSpaceAccess(req, spaceId);
      res
        .status(202)
        .json(await service.queueSend(spaceId, req.body, actor(req)));
    },
  );
  router.get("/spaces/:spaceId/email/tasks/:issueId", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const issueId = req.params.issueId as string;
    if (issueId !== issueId.trim() || !isUuidLike(issueId)) {
      throw badRequest("Task ID must be a UUID");
    }
    await service.authorizeRead(
      spaceId,
      issueId,
      actor(req),
    );
    const thread = await service.thread(
      spaceId,
      issueId,
    );
    if (
      thread &&
      req.actor.type === "agent" &&
      thread.endpoint.assignedAgentId !== req.actor.agentId
    )
      throw notFound("Email task not found");
    res.json(thread);
  });
  router.get(
    "/spaces/:spaceId/email/deliveries/:publicationId",
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      assertSpaceAccess(req, spaceId);
      const delivery = await service.publication(
        req.params.publicationId as string,
        spaceId,
      );
      await service.authorizeRead(spaceId, delivery.issueId, actor(req));
      const thread = await service.thread(spaceId, delivery.issueId);
      if (
        req.actor.type === "agent" &&
        thread?.endpoint.assignedAgentId !== req.actor.agentId
      )
        throw notFound("Email delivery not found");
      res.json(delivery);
    },
  );
  router.use(agentmailErrorHandler);
  return router;
}
export function emailWebhookRoutes(service: EmailChannelService) {
  const router = Router();
  router.post("/api/chat-webhooks/agentmail/:publicId", async (req, res) => {
    const headers: Record<string, string> = {};
    for (const key of ["svix-id", "svix-timestamp", "svix-signature"])
      if (typeof req.headers[key] === "string") headers[key] = req.headers[key];
    if (!Buffer.isBuffer(req.body))
      throw forbidden("Raw webhook body required");
    await service.webhook(req.params.publicId, req.body, headers);
    res.sendStatus(204);
  });
  return router;
}
