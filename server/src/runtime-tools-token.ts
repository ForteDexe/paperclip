import { createHmac, timingSafeEqual } from "node:crypto";
import { resolveOutpostInstanceId } from "./home-paths.js";

export interface RuntimeToolsTokenClaims {
  sub: string;
  space_id: string;
  run_id: string;
  responsible_user_id: string;
  scope: "connection_intents" | "github_credentials";
  iat: number;
  exp: number;
  instance_id: string;
}

const TOKEN_TTL_SECONDS = 60 * 60;

function secret() {
  return process.env.OUTPOST_AGENT_JWT_SECRET?.trim()
    || process.env.BETTER_AUTH_SECRET?.trim()
    || null;
}

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function sign(value: string, spaceId: string, instanceId: string) {
  const master = secret();
  if (!master) return null;
  const key = createHmac("sha256", master)
    .update(`runtime-tools:${instanceId}:${spaceId}`)
    .digest();
  return createHmac("sha256", key).update(value).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createRuntimeToolsToken(input: {
  agentId: string;
  spaceId: string;
  runId: string;
  responsibleUserId: string;
  scope?: RuntimeToolsTokenClaims["scope"];
}) {
  if (!secret()) return null;
  const now = Math.floor(Date.now() / 1000);
  const instanceId = resolveOutpostInstanceId();
  const claims: RuntimeToolsTokenClaims = {
    sub: input.agentId,
    space_id: input.spaceId,
    run_id: input.runId,
    responsible_user_id: input.responsibleUserId,
    scope: input.scope ?? "connection_intents",
    iat: now,
    // Broker tokens remain scoped to a live run, which is rechecked on every use.
    exp: now + (input.scope === "github_credentials" ? 30 * 24 * 60 * 60 : TOKEN_TTL_SECONDS),
    instance_id: instanceId,
  };
  const signingInput = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(claims)}`;
  const signature = sign(signingInput, input.spaceId, instanceId);
  return signature
    ? { token: `${signingInput}.${signature}`, expiresAt: new Date(claims.exp * 1000).toISOString() }
    : null;
}

export function verifyRuntimeToolsToken(token: string, scope: RuntimeToolsTokenClaims["scope"] = "connection_intents"): RuntimeToolsTokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (header.alg !== "HS256") return null;
  const spaceId = typeof claims.space_id === "string" ? claims.space_id : null;
  const instanceId = typeof claims.instance_id === "string" ? claims.instance_id : null;
  if (!spaceId || !instanceId || instanceId !== resolveOutpostInstanceId()) return null;
  const expected = sign(`${parts[0]}.${parts[1]}`, spaceId, instanceId);
  if (!expected || !safeEqual(parts[2]!, expected)) return null;
  if (
    typeof claims.sub !== "string"
    || typeof claims.run_id !== "string"
    || typeof claims.responsible_user_id !== "string"
    || claims.scope !== scope
    || typeof claims.iat !== "number"
    || typeof claims.exp !== "number"
    || claims.exp <= Math.floor(Date.now() / 1000)
  ) return null;
  return claims as unknown as RuntimeToolsTokenClaims;
}
