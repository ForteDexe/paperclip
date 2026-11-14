import { notifyRetentionWork, writeJoinRequestChange } from "../services/retention-work-notifications.js";
import { createAgentLifecycle } from "../services/agent-lifecycle.js";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import fs from "node:fs";
import type { IncomingMessage, RequestOptions as HttpRequestOptions } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, ne } from "drizzle-orm";
import type { Db } from "@outpost/db";
import {
  assets,
  agentApiKeys,
  authUsers,
  spaces,
  spaceLogos,
  spaceMemberships,
  instanceUserRoles,
  invites,
  joinRequests,
  principalPermissionGrants,
} from "@outpost/db";
import {
  EXTERNAL_AGENT_TOOL_GUIDANCE,
  acceptInviteSchema,
  createCliAuthChallengeSchema,
  claimJoinRequestApiKeySchema,
  createOperatorApiKeySchema,
  createSpaceInviteSchema,
  createOpenClawInvitePromptSchema,
  listSpaceInvitesQuerySchema,
  listJoinRequestsQuerySchema,
  resolveCliAuthChallengeSchema,
  searchAdminUsersQuerySchema,
  updateSpaceMemberWithPermissionsSchema,
  updateSpaceMemberSchema,
  archiveSpaceMemberSchema,
  updateMemberPermissionsSchema,
  updateUserSpaceAccessSchema,
  PERMISSION_KEYS,
  isUuidLike,
} from "@outpost/shared";
import type { DeploymentExposure, DeploymentMode, HumanSpaceMembershipRole } from "@outpost/shared";
import {
  forbidden,
  conflict,
  notFound,
  unauthorized,
  badRequest,
  tooManyRequests
} from "../errors.js";
import { getHiddenSettings } from "../services/settings-visibility.js";
import { runtimeCanonicalOrigin } from "../services/cloud-runtime-identity.js";

/**
 * Floor: when the hosting operator hides the Instance Access surface
 * (`instance.access` in OUTPOST_HIDDEN_SETTINGS), instance-admin user
 * management is rejected alongside it — user administration then belongs to
 * the operator's own control plane. Applies to the Access page's reads too;
 * invite and space-membership routes are space-scoped and stay open.
 */
function assertAccessAdminVisible() {
  if (getHiddenSettings().has("instance.access")) {
    throw forbidden("Instance user administration is managed by the hosting operator on this instance", {
      code: "settings_operator_managed",
    });
  }
}
import {
  createInviteRateLimiter,
  type InviteRateLimiter,
} from "../services/invite-rate-limit.js";
import { logger } from "../middleware/logger.js";
import { validate } from "../middleware/validate.js";
import { collectReachableInterfaceHosts } from "../runtime-api.js";
import {
  accessService,
  agentService,
  operatorAuthService,
  deduplicateAgentName,
  logActivity,
  notifyCreateApproved
} from "../services/index.js";
import {
  grantsForHumanRole,
  normalizeHumanRole,
  resolveHumanInviteRole,
} from "../services/space-member-roles.js";
import { agentJoinGrantsFromDefaults as standardAgentJoinGrantsFromDefaults, humanJoinGrantsFromDefaults } from "../services/invite-grants.js";
import {
  collapseDuplicatePendingHumanJoinRequests,
  findReusableHumanJoinRequest,
} from "../lib/join-request-dedupe.js";
import { assertAuthenticated, assertSpaceAccess } from "./authz.js";
import {
  claimOperatorOwnership,
  inspectOperatorClaimChallenge
} from "../operator-claim.js";
import { claimFirstInstanceAdmin } from "../first-admin-claim.js";
import { getStorageService } from "../storage/index.js";
import { secretService } from "../services/secrets.js";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

const INVITE_TOKEN_PREFIX = "pcp_invite_";
// 32 random bytes = 256 bits of entropy, base64url-encoded (43 chars). The
// invite token is public (anyone with the link can GET/accept the invite), so
// it must not be brute-forceable. The previous 8-char base36 suffix carried only
// ~41 bits, which is online-enumerable. The token is stored hashed (sha256) in
// `invites.tokenHash`; the raw value is only returned once on creation.
const INVITE_TOKEN_ENTROPY_BYTES = 32;
const INVITE_TOKEN_MAX_RETRIES = 5;
const SPACE_INVITE_TTL_MS = 72 * 60 * 60 * 1000;
const INVITE_RESOLUTION_DNS_TIMEOUT_MS = 3_000;

export function createInviteToken() {
  const suffix = randomBytes(INVITE_TOKEN_ENTROPY_BYTES).toString("base64url");
  return `${INVITE_TOKEN_PREFIX}${suffix}`;
}

function createClaimSecret() {
  return `pcp_claim_${randomBytes(24).toString("hex")}`;
}

export function spaceInviteExpiresAt(nowMs: number = Date.now()) {
  return new Date(nowMs + SPACE_INVITE_TTL_MS);
}

function tokenHashesMatch(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function requestBaseUrl(req: Request) {
  const forwardedProto = req.header("x-forwarded-proto");
  const proto = forwardedProto?.split(",")[0]?.trim() || req.protocol || "http";
  const host =
    req.header("x-forwarded-host")?.split(",")[0]?.trim() || req.header("host");
  if (!host) return "";
  return `${proto}://${host}`;
}

function resolveBaseUrl(req: Request, authPublicBaseUrl?: string): string {
  const runtimeOrigin = runtimeCanonicalOrigin();
  if (runtimeOrigin) return runtimeOrigin;
  if (authPublicBaseUrl) return authPublicBaseUrl.replace(/\/+$/, "");
  return requestBaseUrl(req);
}

function buildCliAuthApprovalPath(challengeId: string, token: string) {
  return `/cli-auth/${challengeId}?token=${encodeURIComponent(token)}`;
}

function readSkillMarkdown(skillName: string): string | null {
  const normalized = skillName.trim().toLowerCase();
  if (!isSafeSkillName(normalized)) {
    return null;
  }
  // Keep the original bootstrap URL working after the monolithic skill was
  // split into focused skills. Task execution is the minimum invite contract.
  const resolvedName = normalized === "outpost" ? "outpost-task" : normalized;
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const claudeSkillsDir = resolveClaudeSkillsDir();
  const candidates = [
    claudeSkillsDir ? path.resolve(claudeSkillsDir, resolvedName, "SKILL.md") : null,
    path.resolve(moduleDir, "../../skills", resolvedName, "SKILL.md"), // published: dist/routes/ -> <pkg>/skills/
    path.resolve(process.cwd(), "skills", resolvedName, "SKILL.md"), // cwd (e.g. monorepo root)
    path.resolve(moduleDir, "../../../skills", resolvedName, "SKILL.md") // dev: src/routes/ -> repo root/skills/
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const skillPath of candidates) {
    try {
      return fs.readFileSync(skillPath, "utf8");
    } catch {
      // Continue to next candidate.
    }
  }
  return null;
}

function isSafeSkillName(skillName: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/.test(skillName);
}

/** Resolve the Outpost repo skills directory (built-in / managed skills). */
function resolveOutpostSkillsDir(): string | null {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(moduleDir, "../../skills"),         // published
    path.resolve(process.cwd(), "skills"),           // cwd (monorepo root)
    path.resolve(moduleDir, "../../../skills"),       // dev
  ];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch { /* skip */ }
  }
  return null;
}

/** Parse YAML frontmatter from a SKILL.md file to extract the description. */
function parseSkillFrontmatter(markdown: string): { description: string } {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { description: "" };
  const yaml = match[1];
  // Extract description — handles both single-line and multi-line YAML values
  const descMatch = yaml.match(
    /^description:\s*(?:>\s*\n((?:\s{2,}[^\n]*\n?)+)|[|]\s*\n((?:\s{2,}[^\n]*\n?)+)|["']?(.*?)["']?\s*$)/m
  );
  if (!descMatch) return { description: "" };
  const raw = descMatch[1] ?? descMatch[2] ?? descMatch[3] ?? "";
  return {
    description: raw
      .split("\n")
      .map((l: string) => l.trim())
      .filter(Boolean)
      .join(" ")
      .trim(),
  };
}

interface AvailableSkill {
  name: string;
  description: string;
  isOutpostManaged: boolean;
}

/** Discover all available Claude Code skills from CLAUDE_HOME or ~/.claude. */
function resolveClaudeSkillsDir(): string {
  const configuredClaudeHome = process.env.CLAUDE_HOME?.trim();
  const claudeHome = configuredClaudeHome
    ? path.resolve(configuredClaudeHome)
    : path.join(process.env.HOME || process.env.USERPROFILE || "", ".claude");
  return path.join(claudeHome, "skills");
}

function listAvailableSkills(): AvailableSkill[] {
  const claudeSkillsDir = resolveClaudeSkillsDir();
  const outpostSkillsDir = resolveOutpostSkillsDir();

  // Build set of Outpost-managed skill names
  const outpostSkillNames = new Set<string>();
  if (outpostSkillsDir) {
    try {
      for (const entry of fs.readdirSync(outpostSkillsDir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name === "outpost") outpostSkillNames.add(entry.name);
      }
    } catch { /* skip */ }
  }

  const skills: AvailableSkill[] = [];
  const retiredBundledSkillNames = new Set([
    "agentmail", "complain", "first-task",
    "outpost-converting-plans-to-tasks",
    "para-memory-files", "slack", "suggestion-box",
  ]);

  try {
    const entries = fs.readdirSync(claudeSkillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (entry.name.startsWith(".")) continue;
      if (retiredBundledSkillNames.has(entry.name)) continue;
      const skillMdPath = path.join(claudeSkillsDir, entry.name, "SKILL.md");
      let description = "";
      try {
        const md = fs.readFileSync(skillMdPath, "utf8");
        description = parseSkillFrontmatter(md).description;
      } catch { /* no SKILL.md or unreadable */ }
      skills.push({
        name: entry.name,
        description,
        isOutpostManaged: outpostSkillNames.has(entry.name),
      });
    }
  } catch { /* Claude skills directory doesn't exist */ }

  if (outpostSkillsDir) {
    const existingNames = new Set(skills.map((skill) => skill.name));
    try {
      for (const entry of fs.readdirSync(outpostSkillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name !== "outpost" || existingNames.has(entry.name)) continue;
        const skillMdPath = path.join(outpostSkillsDir, entry.name, "SKILL.md");
        let description = "";
        try {
          const md = fs.readFileSync(skillMdPath, "utf8");
          description = parseSkillFrontmatter(md).description;
        } catch { /* no SKILL.md or unreadable */ }
        skills.push({
          name: entry.name,
          description,
          isOutpostManaged: true,
        });
      }
    } catch { /* skip Outpost skills directory */ }
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

function toJoinRequestResponse(row: typeof joinRequests.$inferSelect) {
  const { claimSecretHash: _claimSecretHash, ...safe } = row;
  return safe;
}

type JoinDiagnostic = {
  code: string;
  level: "info" | "warn";
  message: string;
  hint?: string;
};

const DEFAULT_HERMES_DASHBOARD_PORT = "9119";
const HERMES_DASHBOARD_API_PATHS = new Set(["", "/", "/chat"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLoopbackHost(hostname: string): boolean {
  const value = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return (
    value === "localhost" ||
    value === "::1" ||
    value === "0:0:0:0:0:0:0:1" ||
    value === "127.0.0.1" ||
    /^127(?:\.\d{1,3}){3}$/.test(value)
  );
}

function normalizeHermesGatewayApiBaseUrl(url: URL): URL {
  const normalized = new URL(url.toString());
  const normalizedPath = normalized.pathname.replace(/\/+$/, "") || "/";
  if (
    normalized.port === DEFAULT_HERMES_DASHBOARD_PORT &&
    HERMES_DASHBOARD_API_PATHS.has(normalizedPath)
  ) {
    normalized.pathname = "/api";
  }
  return normalized;
}

function isDefaultHermesDashboardRoot(url: URL): boolean {
  const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";
  return (
    url.port === DEFAULT_HERMES_DASHBOARD_PORT &&
    HERMES_DASHBOARD_API_PATHS.has(normalizedPath)
  );
}

function normalizeHostname(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end > 1
      ? trimmed.slice(1, end).toLowerCase()
      : trimmed.toLowerCase();
  }
  const firstColon = trimmed.indexOf(":");
  if (firstColon > -1) return trimmed.slice(0, firstColon).toLowerCase();
  return trimmed.toLowerCase();
}

function normalizeHeaderValue(
  value: unknown,
  depth: number = 0
): string | null {
  const direct = nonEmptyTrimmedString(value);
  if (direct) return direct;
  if (!isPlainObject(value) || depth >= 3) return null;

  const candidateKeys = [
    "value",
    "token",
    "secret",
    "apiKey",
    "api_key",
    "auth",
    "authToken",
    "auth_token",
    "accessToken",
    "access_token",
    "authorization",
    "bearer",
    "header",
    "raw",
    "text",
    "string"
  ];
  for (const key of candidateKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const normalized = normalizeHeaderValue(
      (value as Record<string, unknown>)[key],
      depth + 1
    );
    if (normalized) return normalized;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 1) {
    const [singleKey, singleValue] = entries[0];
    const normalizedKey = singleKey.trim().toLowerCase();
    if (
      normalizedKey !== "type" &&
      normalizedKey !== "version" &&
      normalizedKey !== "secretid" &&
      normalizedKey !== "secret_id"
    ) {
      const normalized = normalizeHeaderValue(singleValue, depth + 1);
      if (normalized) return normalized;
    }
  }

  return null;
}

function extractHeaderEntries(input: unknown): Array<[string, unknown]> {
  if (isPlainObject(input)) {
    return Object.entries(input);
  }
  if (!Array.isArray(input)) {
    return [];
  }

  const entries: Array<[string, unknown]> = [];
  for (const item of input) {
    if (Array.isArray(item)) {
      const key = nonEmptyTrimmedString(item[0]);
      if (!key) continue;
      entries.push([key, item[1]]);
      continue;
    }
    if (!isPlainObject(item)) continue;

    const mapped = item as Record<string, unknown>;
    const explicitKey =
      nonEmptyTrimmedString(mapped.key) ??
      nonEmptyTrimmedString(mapped.name) ??
      nonEmptyTrimmedString(mapped.header);
    if (explicitKey) {
      const explicitValue = Object.prototype.hasOwnProperty.call(
        mapped,
        "value"
      )
        ? mapped.value
        : Object.prototype.hasOwnProperty.call(mapped, "token")
        ? mapped.token
        : Object.prototype.hasOwnProperty.call(mapped, "secret")
        ? mapped.secret
        : mapped;
      entries.push([explicitKey, explicitValue]);
      continue;
    }

    const singleEntry = Object.entries(mapped);
    if (singleEntry.length === 1) {
      entries.push(singleEntry[0] as [string, unknown]);
    }
  }

  return entries;
}

function normalizeHeaderMap(
  input: unknown
): Record<string, string> | undefined {
  const entries = extractHeaderEntries(input);
  if (entries.length === 0) return undefined;

  const out: Record<string, string> = {};
  for (const [key, value] of entries) {
    const normalizedValue = normalizeHeaderValue(value);
    if (!normalizedValue) continue;
    const trimmedKey = key.trim();
    const trimmedValue = normalizedValue.trim();
    if (!trimmedKey || !trimmedValue) continue;
    out[trimmedKey] = trimmedValue;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function nonEmptyTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function headerMapHasKeyIgnoreCase(
  headers: Record<string, string>,
  targetKey: string
): boolean {
  const normalizedTarget = targetKey.trim().toLowerCase();
  return Object.keys(headers).some(
    (key) => key.trim().toLowerCase() === normalizedTarget
  );
}

function headerMapGetIgnoreCase(
  headers: Record<string, string>,
  targetKey: string
): string | null {
  const normalizedTarget = targetKey.trim().toLowerCase();
  const key = Object.keys(headers).find(
    (candidate) => candidate.trim().toLowerCase() === normalizedTarget
  );
  if (!key) return null;
  const value = headers[key];
  return typeof value === "string" ? value : null;
}

function tokenFromAuthorizationHeader(rawHeader: string | null): string | null {
  const trimmed = nonEmptyTrimmedString(rawHeader);
  if (!trimmed) return null;
  const bearerMatch = trimmed.match(/^bearer\s+(.+)$/i);
  if (bearerMatch?.[1]) {
    return nonEmptyTrimmedString(bearerMatch[1]);
  }
  return trimmed;
}

function parseBooleanLike(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return null;
}

function generateEd25519PrivateKeyPem(): string {
  const generated = generateKeyPairSync("ed25519");
  return generated.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
}

export function buildJoinDefaultsPayloadForAccept(input: {
  adapterType: string | null;
  defaultsPayload: unknown;
  outpostApiUrl?: unknown;
  inboundOpenClawAuthHeader?: string | null;
  inboundOpenClawTokenHeader?: string | null;
}): unknown {
  if (input.adapterType !== "openclaw_gateway") {
    return input.defaultsPayload;
  }

  const merged = isPlainObject(input.defaultsPayload)
    ? { ...(input.defaultsPayload as Record<string, unknown>) }
    : ({} as Record<string, unknown>);

  if (!nonEmptyTrimmedString(merged.outpostApiUrl)) {
    const legacyOutpostApiUrl = nonEmptyTrimmedString(input.outpostApiUrl);
    if (legacyOutpostApiUrl) merged.outpostApiUrl = legacyOutpostApiUrl;
  }
  const mergedHeaders = normalizeHeaderMap(merged.headers) ?? {};

  const inboundOpenClawAuthHeader = nonEmptyTrimmedString(
    input.inboundOpenClawAuthHeader
  );
  const inboundOpenClawTokenHeader = nonEmptyTrimmedString(
    input.inboundOpenClawTokenHeader
  );
  if (
    inboundOpenClawTokenHeader &&
    !headerMapHasKeyIgnoreCase(mergedHeaders, "x-openclaw-token")
  ) {
    mergedHeaders["x-openclaw-token"] = inboundOpenClawTokenHeader;
  }
  if (
    inboundOpenClawAuthHeader &&
    !headerMapHasKeyIgnoreCase(mergedHeaders, "x-openclaw-auth")
  ) {
    mergedHeaders["x-openclaw-auth"] = inboundOpenClawAuthHeader;
  }

  if (Object.keys(mergedHeaders).length > 0) {
    merged.headers = mergedHeaders;
  } else {
    delete merged.headers;
  }

  const discoveredToken =
    headerMapGetIgnoreCase(mergedHeaders, "x-openclaw-token") ??
    headerMapGetIgnoreCase(mergedHeaders, "x-openclaw-auth") ??
    tokenFromAuthorizationHeader(
      headerMapGetIgnoreCase(mergedHeaders, "authorization")
    );
  if (
    discoveredToken &&
    !headerMapHasKeyIgnoreCase(mergedHeaders, "x-openclaw-token")
  ) {
    mergedHeaders["x-openclaw-token"] = discoveredToken;
  }

  return Object.keys(merged).length > 0 ? merged : null;
}

export function mergeJoinDefaultsPayloadForReplay(
  existingDefaultsPayload: unknown,
  nextDefaultsPayload: unknown
): unknown {
  if (
    !isPlainObject(existingDefaultsPayload) &&
    !isPlainObject(nextDefaultsPayload)
  ) {
    return nextDefaultsPayload ?? existingDefaultsPayload;
  }
  if (!isPlainObject(existingDefaultsPayload)) {
    return nextDefaultsPayload;
  }
  if (!isPlainObject(nextDefaultsPayload)) {
    return existingDefaultsPayload;
  }

  const merged: Record<string, unknown> = {
    ...(existingDefaultsPayload as Record<string, unknown>),
    ...(nextDefaultsPayload as Record<string, unknown>)
  };

  const existingHeaders = normalizeHeaderMap(
    (existingDefaultsPayload as Record<string, unknown>).headers
  );
  const nextHeaders = normalizeHeaderMap(
    (nextDefaultsPayload as Record<string, unknown>).headers
  );
  if (existingHeaders || nextHeaders) {
    merged.headers = {
      ...(existingHeaders ?? {}),
      ...(nextHeaders ?? {})
    };
  } else if (Object.prototype.hasOwnProperty.call(merged, "headers")) {
    delete merged.headers;
  }

  return merged;
}

export function canReplayOpenClawGatewayInviteAccept(input: {
  requestType: "human" | "agent";
  adapterType: string | null;
  existingJoinRequest: Pick<
    typeof joinRequests.$inferSelect,
    "requestType" | "adapterType" | "status"
  > | null;
}): boolean {
  if (
    input.requestType !== "agent" ||
    input.adapterType !== "openclaw_gateway"
  ) {
    return false;
  }
  if (!input.existingJoinRequest) {
    return false;
  }
  if (
    input.existingJoinRequest.requestType !== "agent" ||
    input.existingJoinRequest.adapterType !== "openclaw_gateway"
  ) {
    return false;
  }
  return (
    input.existingJoinRequest.status === "pending_approval" ||
    input.existingJoinRequest.status === "approved"
  );
}

export function assertLegacyAgentInviteAdapterType(
  adapterType: string | null | undefined,
) {
  if (adapterType === "outpost_runner") {
    throw badRequest(
      "Outpost Runner is not available through agent invite onboarding.",
      { code: "outpost_runner_invite_onboarding_disabled" },
    );
  }
}

function summarizeSecretForLog(
  value: unknown
): { present: true; length: number; sha256Prefix: string } | null {
  const trimmed = nonEmptyTrimmedString(value);
  if (!trimmed) return null;
  return {
    present: true,
    length: trimmed.length,
    sha256Prefix: hashToken(trimmed).slice(0, 12)
  };
}

function summarizeOpenClawGatewayDefaultsForLog(defaultsPayload: unknown) {
  const defaults = isPlainObject(defaultsPayload)
    ? (defaultsPayload as Record<string, unknown>)
    : null;
  const headers = defaults ? normalizeHeaderMap(defaults.headers) : undefined;
  const gatewayTokenValue = headers
    ? headerMapGetIgnoreCase(headers, "x-openclaw-token") ??
      headerMapGetIgnoreCase(headers, "x-openclaw-auth") ??
      tokenFromAuthorizationHeader(
        headerMapGetIgnoreCase(headers, "authorization")
      )
    : null;
  return {
    present: Boolean(defaults),
    keys: defaults ? Object.keys(defaults).sort() : [],
    url: defaults ? nonEmptyTrimmedString(defaults.url) : null,
    outpostApiUrl: defaults
      ? nonEmptyTrimmedString(defaults.outpostApiUrl)
      : null,
    headerKeys: headers ? Object.keys(headers).sort() : [],
    sessionKeyStrategy: defaults
      ? nonEmptyTrimmedString(defaults.sessionKeyStrategy)
      : null,
    disableDeviceAuth: defaults
      ? parseBooleanLike(defaults.disableDeviceAuth)
      : null,
    waitTimeoutMs:
      defaults && typeof defaults.waitTimeoutMs === "number"
        ? defaults.waitTimeoutMs
        : null,
    devicePrivateKeyPem: defaults
      ? summarizeSecretForLog(defaults.devicePrivateKeyPem)
      : null,
    gatewayToken: summarizeSecretForLog(gatewayTokenValue)
  };
}

export function normalizeAgentDefaultsForJoin(input: {
  adapterType: string | null;
  defaultsPayload: unknown;
  deploymentMode: DeploymentMode;
  deploymentExposure: DeploymentExposure;
  bindHost: string;
  allowedHostnames: string[];
}) {
  const fatalErrors: string[] = [];
  const diagnostics: JoinDiagnostic[] = [];
  if (input.adapterType === "hermes_gateway") {
    if (!isPlainObject(input.defaultsPayload)) {
      diagnostics.push({
        code: "hermes_gateway_defaults_missing",
        level: "warn",
        message: "No Hermes gateway config was provided in agentDefaultsPayload.",
        hint: "Include agentDefaultsPayload.apiBaseUrl and agentDefaultsPayload.apiKey for Hermes gateway joins.",
      });
      fatalErrors.push("agentDefaultsPayload is required for adapterType=hermes_gateway");
      return { normalized: null as Record<string, unknown> | null, diagnostics, fatalErrors };
    }

    const defaults = input.defaultsPayload as Record<string, unknown>;
    const normalized = { ...defaults };
    const rawApiBaseUrl = nonEmptyTrimmedString(defaults.apiBaseUrl ?? defaults.url);
    if (!rawApiBaseUrl) {
      diagnostics.push({
        code: "hermes_gateway_api_base_url_missing",
        level: "warn",
        message: "Hermes gateway apiBaseUrl is missing.",
        hint: "Set agentDefaultsPayload.apiBaseUrl to the Hermes API server URL. The default dashboard root or chat URL on port 9119 is accepted and maps to /api.",
      });
      fatalErrors.push("agentDefaultsPayload.apiBaseUrl is required");
    } else {
      try {
        const rawParsedApiBaseUrl = new URL(rawApiBaseUrl);
        const mappedDefaultDashboardRoot = isDefaultHermesDashboardRoot(rawParsedApiBaseUrl);
        const apiBaseUrl = normalizeHermesGatewayApiBaseUrl(rawParsedApiBaseUrl);
        if (apiBaseUrl.protocol !== "http:" && apiBaseUrl.protocol !== "https:") {
          diagnostics.push({
            code: "hermes_gateway_api_base_url_protocol",
            level: "warn",
            message: `Hermes gateway apiBaseUrl must use http:// or https:// (got ${apiBaseUrl.protocol}).`,
          });
          fatalErrors.push("agentDefaultsPayload.apiBaseUrl must use http:// or https:// for hermes_gateway");
        } else if (
          apiBaseUrl.protocol === "http:" &&
          !isLoopbackHost(apiBaseUrl.hostname) &&
          parseBooleanLike(defaults.dangerouslyAllowInsecureRemoteHttp) !== true
        ) {
          diagnostics.push({
            code: "hermes_gateway_plain_http_remote_denied",
            level: "warn",
            message: "Remote plain HTTP Hermes gateway traffic is denied by default.",
            hint: "Use https:// or set agentDefaultsPayload.dangerouslyAllowInsecureRemoteHttp=true only for unsafe local development.",
          });
          fatalErrors.push(
            "agentDefaultsPayload.apiBaseUrl uses remote plain HTTP; use HTTPS or set dangerouslyAllowInsecureRemoteHttp=true for unsafe local development",
          );
        } else {
          normalized.apiBaseUrl = apiBaseUrl.toString();
          if (mappedDefaultDashboardRoot) {
            diagnostics.push({
              code: "hermes_gateway_dashboard_root_mapped",
              level: "info",
              message: `Default Hermes dashboard root mapped to API base ${apiBaseUrl.toString()}`,
              hint: "Hermes dashboard and /chat routes are browser UI routes. Outpost gateway calls use /api/health and /api/v1/runs.",
            });
          }
          if (apiBaseUrl.protocol === "http:" && !isLoopbackHost(apiBaseUrl.hostname)) {
            diagnostics.push({
              code: "hermes_gateway_plain_http_remote_unsafe_allowed",
              level: "warn",
              message: "Unsafe dev escape hatch enabled for non-loopback HTTP Hermes traffic.",
            });
          } else {
            diagnostics.push({
              code: "hermes_gateway_api_base_url_configured",
              level: "info",
              message: `Hermes gateway endpoint set to ${apiBaseUrl.toString()}`,
            });
          }
        }
      } catch {
        diagnostics.push({
          code: "hermes_gateway_api_base_url_invalid",
          level: "warn",
          message: `Invalid Hermes gateway apiBaseUrl: ${rawApiBaseUrl}`,
        });
        fatalErrors.push("agentDefaultsPayload.apiBaseUrl is not a valid URL");
      }
    }

    if (!nonEmptyTrimmedString(defaults.apiKey)) {
      diagnostics.push({
        code: "hermes_gateway_api_key_missing",
        level: "warn",
        message: "Hermes gateway API key is missing.",
        hint: "Set agentDefaultsPayload.apiKey to the Hermes API_SERVER_KEY value.",
      });
      fatalErrors.push("agentDefaultsPayload.apiKey is required");
    }

    return { normalized, diagnostics, fatalErrors };
  }
  if (input.adapterType !== "openclaw_gateway") {
    const normalized = isPlainObject(input.defaultsPayload)
      ? (input.defaultsPayload as Record<string, unknown>)
      : null;
    return { normalized, diagnostics, fatalErrors };
  }

  if (!isPlainObject(input.defaultsPayload)) {
    diagnostics.push({
      code: "openclaw_gateway_defaults_missing",
      level: "warn",
      message:
        "No OpenClaw gateway config was provided in agentDefaultsPayload.",
      hint:
        "Include agentDefaultsPayload.url and headers.x-openclaw-token for OpenClaw gateway joins."
    });
    fatalErrors.push(
      "agentDefaultsPayload is required for adapterType=openclaw_gateway"
    );
    return {
      normalized: null as Record<string, unknown> | null,
      diagnostics,
      fatalErrors
    };
  }

  const defaults = input.defaultsPayload as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};

  let gatewayUrl: URL | null = null;
  const rawGatewayUrl = nonEmptyTrimmedString(defaults.url);
  if (!rawGatewayUrl) {
    diagnostics.push({
      code: "openclaw_gateway_url_missing",
      level: "warn",
      message: "OpenClaw gateway URL is missing.",
      hint: "Set agentDefaultsPayload.url to ws:// or wss:// gateway URL."
    });
    fatalErrors.push("agentDefaultsPayload.url is required");
  } else {
    try {
      gatewayUrl = new URL(rawGatewayUrl);
      if (gatewayUrl.protocol !== "ws:" && gatewayUrl.protocol !== "wss:") {
        diagnostics.push({
          code: "openclaw_gateway_url_protocol",
          level: "warn",
          message: `OpenClaw gateway URL must use ws:// or wss:// (got ${gatewayUrl.protocol}).`
        });
        fatalErrors.push(
          "agentDefaultsPayload.url must use ws:// or wss:// for openclaw_gateway"
        );
      } else {
        normalized.url = gatewayUrl.toString();
        diagnostics.push({
          code: "openclaw_gateway_url_configured",
          level: "info",
          message: `Gateway endpoint set to ${gatewayUrl.toString()}`
        });
      }
    } catch {
      diagnostics.push({
        code: "openclaw_gateway_url_invalid",
        level: "warn",
        message: `Invalid OpenClaw gateway URL: ${rawGatewayUrl}`
      });
      fatalErrors.push("agentDefaultsPayload.url is not a valid URL");
    }
  }

  const headers = normalizeHeaderMap(defaults.headers) ?? {};
  const gatewayToken =
    headerMapGetIgnoreCase(headers, "x-openclaw-token") ??
    headerMapGetIgnoreCase(headers, "x-openclaw-auth") ??
    tokenFromAuthorizationHeader(headerMapGetIgnoreCase(headers, "authorization"));
  if (gatewayToken && !headerMapHasKeyIgnoreCase(headers, "x-openclaw-token")) {
    headers["x-openclaw-token"] = gatewayToken;
  }
  if (Object.keys(headers).length > 0) {
    normalized.headers = headers;
  }

  if (!gatewayToken) {
    diagnostics.push({
      code: "openclaw_gateway_auth_header_missing",
      level: "warn",
      message: "Gateway auth token is missing from agent defaults.",
      hint:
        "Set agentDefaultsPayload.headers.x-openclaw-token (or legacy x-openclaw-auth)."
    });
    fatalErrors.push(
      "agentDefaultsPayload.headers.x-openclaw-token (or x-openclaw-auth) is required"
    );
  } else if (gatewayToken.trim().length < 16) {
    diagnostics.push({
      code: "openclaw_gateway_auth_header_too_short",
      level: "warn",
      message: `Gateway auth token appears too short (${gatewayToken.trim().length} chars).`,
      hint:
        "Use the full gateway auth token from ~/.openclaw/openclaw.json (typically long random string)."
    });
    fatalErrors.push(
      "agentDefaultsPayload.headers.x-openclaw-token is too short; expected a full gateway token"
    );
  } else {
    diagnostics.push({
      code: "openclaw_gateway_auth_header_configured",
      level: "info",
      message: "Gateway auth token configured."
    });
  }

  if (isPlainObject(defaults.payloadTemplate)) {
    normalized.payloadTemplate = defaults.payloadTemplate;
  }

  const parsedDisableDeviceAuth = parseBooleanLike(defaults.disableDeviceAuth);
  const disableDeviceAuth = parsedDisableDeviceAuth === true;
  if (parsedDisableDeviceAuth !== null) {
    normalized.disableDeviceAuth = parsedDisableDeviceAuth;
  }

  const configuredDevicePrivateKeyPem = nonEmptyTrimmedString(
    defaults.devicePrivateKeyPem
  );
  if (configuredDevicePrivateKeyPem) {
    normalized.devicePrivateKeyPem = configuredDevicePrivateKeyPem;
    diagnostics.push({
      code: "openclaw_gateway_device_key_configured",
      level: "info",
      message:
        "Gateway device key configured. Pairing approvals should persist for this agent."
    });
  } else if (!disableDeviceAuth) {
    try {
      normalized.devicePrivateKeyPem = generateEd25519PrivateKeyPem();
      diagnostics.push({
        code: "openclaw_gateway_device_key_generated",
        level: "info",
        message:
          "Generated persistent gateway device key for this join. Pairing approvals should persist for this agent."
      });
    } catch (err) {
      diagnostics.push({
        code: "openclaw_gateway_device_key_generate_failed",
        level: "warn",
        message: `Failed to generate gateway device key: ${
          err instanceof Error ? err.message : String(err)
        }`,
        hint:
          "Set agentDefaultsPayload.devicePrivateKeyPem explicitly or set disableDeviceAuth=true."
      });
      fatalErrors.push(
        "Failed to generate gateway device key. Set devicePrivateKeyPem or disableDeviceAuth=true."
      );
    }
  }

  const waitTimeoutMs =
    typeof defaults.waitTimeoutMs === "number" &&
    Number.isFinite(defaults.waitTimeoutMs)
      ? Math.floor(defaults.waitTimeoutMs)
      : typeof defaults.waitTimeoutMs === "string"
      ? Number.parseInt(defaults.waitTimeoutMs.trim(), 10)
      : NaN;
  if (Number.isFinite(waitTimeoutMs) && waitTimeoutMs > 0) {
    normalized.waitTimeoutMs = waitTimeoutMs;
  }

  const timeoutSec =
    typeof defaults.timeoutSec === "number" && Number.isFinite(defaults.timeoutSec)
      ? Math.floor(defaults.timeoutSec)
      : typeof defaults.timeoutSec === "string"
      ? Number.parseInt(defaults.timeoutSec.trim(), 10)
      : NaN;
  if (Number.isFinite(timeoutSec) && timeoutSec > 0) {
    normalized.timeoutSec = timeoutSec;
  }

  const sessionKeyStrategy = nonEmptyTrimmedString(defaults.sessionKeyStrategy);
  if (
    sessionKeyStrategy === "fixed" ||
    sessionKeyStrategy === "issue" ||
    sessionKeyStrategy === "run"
  ) {
    normalized.sessionKeyStrategy = sessionKeyStrategy;
  }

  const sessionKey = nonEmptyTrimmedString(defaults.sessionKey);
  if (sessionKey) {
    normalized.sessionKey = sessionKey;
  }

  const role = nonEmptyTrimmedString(defaults.role);
  if (role) {
    normalized.role = role;
  }

  if (Array.isArray(defaults.scopes)) {
    const scopes = defaults.scopes
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (scopes.length > 0) {
      normalized.scopes = scopes;
    }
  }

  const rawOutpostApiUrl =
    typeof defaults.outpostApiUrl === "string"
      ? defaults.outpostApiUrl.trim()
      : "";
  if (rawOutpostApiUrl) {
    try {
      const parsedOutpostApiUrl = new URL(rawOutpostApiUrl);
      if (
        parsedOutpostApiUrl.protocol !== "http:" &&
        parsedOutpostApiUrl.protocol !== "https:"
      ) {
        diagnostics.push({
          code: "openclaw_gateway_outpost_api_url_protocol",
          level: "warn",
          message: `outpostApiUrl must use http:// or https:// (got ${parsedOutpostApiUrl.protocol}).`
        });
      } else {
        normalized.outpostApiUrl = parsedOutpostApiUrl.toString();
        diagnostics.push({
          code: "openclaw_gateway_outpost_api_url_configured",
          level: "info",
          message: `outpostApiUrl set to ${parsedOutpostApiUrl.toString()}`
        });
      }
    } catch {
      diagnostics.push({
        code: "openclaw_gateway_outpost_api_url_invalid",
        level: "warn",
        message: `Invalid outpostApiUrl: ${rawOutpostApiUrl}`
      });
    }
  }

  return { normalized, diagnostics, fatalErrors };
}

export async function prepareAgentDefaultsPayloadForJoinPersistence(input: {
  db: Db;
  spaceId: string;
  adapterType: string | null;
  normalized: Record<string, unknown> | null;
  actor?: { userId?: string | null; agentId?: string | null };
}): Promise<Record<string, unknown> | null> {
  if (input.adapterType !== "hermes_gateway" || !input.normalized) {
    return input.normalized;
  }

  return secretService(input.db).normalizeAdapterConfigForPersistence(
    input.spaceId,
    input.normalized,
    { adapterType: input.adapterType, actor: input.actor },
  );
}

function toInviteSummaryResponse(
  req: Request,
  token: string,
  invite: typeof invites.$inferSelect,
  space:
    | string
    | {
      name: string | null;
      logoUrl: string | null;
    }
    | null = null,
  authPublicBaseUrl?: string
) {
  const spaceInfo = typeof space === "string"
    ? { name: space, logoUrl: null }
    : space;
  const baseUrl = resolveBaseUrl(req, authPublicBaseUrl);
  const invitePath = `/invite/${token}`;
  const onboardingPath = `/api/invites/${token}/onboarding`;
  const onboardingTextPath = `/api/invites/${token}/onboarding.txt`;
  const skillIndexPath = `/api/invites/${token}/skills/index`;
  const inviteMessage = extractInviteMessage(invite);
  return {
    id: invite.id,
    spaceId: invite.spaceId,
    spaceName: spaceInfo?.name ?? null,
    spaceLogoUrl: spaceInfo?.logoUrl ?? null,
    inviteType: invite.inviteType,
    allowedJoinTypes: invite.allowedJoinTypes,
    humanRole: extractInviteHumanRole(invite),
    expiresAt: invite.expiresAt,
    invitePath,
    inviteUrl: baseUrl ? `${baseUrl}${invitePath}` : invitePath,
    onboardingPath,
    onboardingUrl: baseUrl ? `${baseUrl}${onboardingPath}` : onboardingPath,
    onboardingTextPath,
    onboardingTextUrl: baseUrl
      ? `${baseUrl}${onboardingTextPath}`
      : onboardingTextPath,
    skillIndexPath,
    skillIndexUrl: baseUrl
      ? `${baseUrl}${skillIndexPath}`
      : skillIndexPath,
    inviteMessage
  };
}

function actorHasActiveUserMembership(req: Request, spaceId: string) {
  return (
    req.actor.type === "operator" &&
    typeof req.actor.userId === "string" &&
    Array.isArray(req.actor.memberships) &&
    req.actor.memberships.some(
      (membership) =>
        membership.spaceId === spaceId && membership.status === "active",
    )
  );
}

async function loadUsersById(db: Db, userIds: string[]) {
  if (userIds.length === 0) return new Map<string, ReturnType<typeof toUserProfile>>();
  const rows = await db
    .select({
      id: authUsers.id,
      email: authUsers.email,
      name: authUsers.name,
      image: authUsers.image,
    })
    .from(authUsers)
    .where(inArray(authUsers.id, userIds));
  return new Map(rows.map((row) => [row.id, toUserProfile(row)]));
}

async function loadSpaceAccessSummary(
  req: Request,
  access: ReturnType<typeof accessService>,
  spaceId: string,
) {
  if (req.actor.type !== "operator") {
    return {
      currentUserRole: null,
      canManageMembers: false,
      canInviteUsers: false,
      canApproveJoinRequests: false,
    };
  }
  if (isLocalImplicit(req)) {
    return {
      currentUserRole: "owner" as const,
      canManageMembers: true,
      canInviteUsers: true,
      canApproveJoinRequests: true,
    };
  }
  const userId = req.actor.userId ?? null;
  const membership =
    userId ? await access.getMembership(spaceId, "user", userId) : null;
  const [canManageMembers, canInviteUsers, canApproveJoinRequests] =
    await Promise.all([
      access.canUser(spaceId, userId, "users:manage_permissions"),
      access.canUser(spaceId, userId, "users:invite"),
      access.canUser(spaceId, userId, "joins:approve"),
    ]);

  return {
    currentUserRole:
      membership?.status === "active" && membership.membershipRole
        ? normalizeHumanRole(membership.membershipRole, "operator")
        : null,
    canManageMembers,
    canInviteUsers,
    canApproveJoinRequests,
  };
}

async function loadSpaceMemberRecords(
  db: Db,
  spaceId: string,
  options: { includeArchived?: boolean } = {},
) {
  const members = await db
    .select()
    .from(spaceMemberships)
    .where(
      and(
        eq(spaceMemberships.spaceId, spaceId),
        eq(spaceMemberships.principalType, "user"),
        options.includeArchived ? undefined : ne(spaceMemberships.status, "archived"),
      ),
    )
    .orderBy(desc(spaceMemberships.updatedAt));

  const userIds = [...new Set(members.map((member) => member.principalId))];
  const [userMap, grants] = await Promise.all([
    loadUsersById(db, userIds),
    userIds.length > 0
      ? db
          .select()
          .from(principalPermissionGrants)
          .where(
            and(
              eq(principalPermissionGrants.spaceId, spaceId),
              eq(principalPermissionGrants.principalType, "user"),
              inArray(principalPermissionGrants.principalId, userIds),
            ),
          )
      : Promise.resolve([]),
  ]);

  const grantsByPrincipalId = new Map<string, typeof grants>();
  for (const grant of grants) {
    const existing = grantsByPrincipalId.get(grant.principalId) ?? [];
    existing.push(grant);
    grantsByPrincipalId.set(grant.principalId, existing);
  }

  return members.map((member) => ({
    ...member,
    principalType: "user" as const,
    membershipRole: member.membershipRole
      ? normalizeHumanRole(member.membershipRole, "operator")
      : null,
    user: userMap.get(member.principalId) ?? null,
    grants: grantsByPrincipalId.get(member.principalId) ?? [],
  }));
}

type SpaceMemberRecord = Awaited<ReturnType<typeof loadSpaceMemberRecords>>[number];

const humanRoleRank: Record<HumanSpaceMembershipRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
  owner: 4,
};

async function resolveActorHumanRole(
  req: Request,
  access: ReturnType<typeof accessService>,
  spaceId: string,
): Promise<HumanSpaceMembershipRole | null> {
  if (req.actor.type !== "operator") return null;
  if (isLocalImplicit(req) || req.actor.isInstanceAdmin) return "owner";
  const userId = req.actor.userId ?? null;
  if (!userId) return null;
  const membership = await access.getMembership(spaceId, "user", userId);
  if (membership?.status !== "active" || !membership.membershipRole) return null;
  return normalizeHumanRole(membership.membershipRole, "operator");
}

async function getProtectedMemberReason(
  req: Request,
  access: ReturnType<typeof accessService>,
  spaceId: string,
  member: { principalId: string; principalType: string; membershipRole: string | null },
  opts?: {
    actorRole?: HumanSpaceMembershipRole | null;
    instanceAdminUserIds?: ReadonlySet<string>;
    operation?: "archive" | "update";
  },
): Promise<string | null> {
  if (member.principalType !== "user") return "Only human space members can be removed.";
  if (req.actor.type !== "operator") return "Operator access is required to remove members.";
  if (member.principalId === req.actor.userId) return "You cannot remove yourself.";
  const isTargetInstanceAdmin = opts?.instanceAdminUserIds
    ? opts.instanceAdminUserIds.has(member.principalId)
    : await access.isInstanceAdmin(member.principalId);
  if (isTargetInstanceAdmin) {
    return "Instance admins cannot be removed from space access.";
  }

  const targetRole = member.membershipRole
    ? normalizeHumanRole(member.membershipRole, "operator")
    : "operator";
  if (opts?.operation === "archive") {
    if (targetRole === "owner") return "Operator owners cannot be removed from space access.";
    if (targetRole === "admin") return "Outpost admins cannot be removed from space access.";
  }

  const actorRole = opts?.actorRole ?? await resolveActorHumanRole(req, access, spaceId);
  if (!actorRole) return "Only active space members can remove users.";
  if (humanRoleRank[targetRole] >= humanRoleRank[actorRole]) {
    return "You can only remove users below your space role.";
  }

  return null;
}

async function assertCanManageSpaceMember(
  req: Request,
  access: ReturnType<typeof accessService>,
  spaceId: string,
  member: { principalId: string; principalType: string; membershipRole: string | null },
  operation: "archive" | "update" = "update",
) {
  const reason = await getProtectedMemberReason(req, access, spaceId, member, { operation });
  if (reason) throw forbidden(reason);
}

async function addSpaceMemberRemovalAccess(
  req: Request,
  db: Db,
  access: ReturnType<typeof accessService>,
  spaceId: string,
  members: SpaceMemberRecord[],
) {
  const actorRole = await resolveActorHumanRole(req, access, spaceId);
  const userIds = [...new Set(members
    .filter((member) => member.principalType === "user")
    .map((member) => member.principalId))];
  const instanceAdminUserIds = userIds.length > 0
    ? new Set(
      await db
        .select({ userId: instanceUserRoles.userId })
        .from(instanceUserRoles)
        .where(and(inArray(instanceUserRoles.userId, userIds), eq(instanceUserRoles.role, "instance_admin")))
        .then((rows) => rows.map((row) => row.userId)),
    )
    : new Set<string>();
  return Promise.all(
    members.map(async (member) => {
      const reason = await getProtectedMemberReason(req, access, spaceId, member, {
        actorRole,
        instanceAdminUserIds,
        operation: "archive",
      });
      return {
        ...member,
        removal: {
          canArchive: !reason,
          reason,
        },
      };
    }),
  );
}

async function loadSpaceUserDirectory(db: Db, spaceId: string) {
  const members = await db
    .select({
      principalId: spaceMemberships.principalId,
      status: spaceMemberships.status,
      membershipRole: spaceMemberships.membershipRole,
    })
    .from(spaceMemberships)
    .where(
      and(
        eq(spaceMemberships.spaceId, spaceId),
        eq(spaceMemberships.principalType, "user"),
        eq(spaceMemberships.status, "active"),
      ),
    )
    .orderBy(desc(spaceMemberships.updatedAt));

  const userIds = [...new Set(members.map((member) => member.principalId))];
  const userMap = await loadUsersById(db, userIds);

  return members.map((member) => ({
    principalId: member.principalId,
    status: "active" as const,
    membershipRole: member.membershipRole,
    user: userMap.get(member.principalId) ?? null,
  }));
}

function inviteStateWhereClause(
  state: "active" | "accepted" | "expired" | "revoked" | undefined,
) {
  const now = new Date();
  switch (state) {
    case "active":
      return and(
        isNull(invites.revokedAt),
        isNull(invites.acceptedAt),
        gt(invites.expiresAt, now),
      );
    case "accepted":
      return isNotNull(invites.acceptedAt);
    case "expired":
      return and(
        isNull(invites.revokedAt),
        isNull(invites.acceptedAt),
        lte(invites.expiresAt, now),
      );
    case "revoked":
      return isNotNull(invites.revokedAt);
    default:
      return undefined;
  }
}

async function loadSpaceInviteRecords(
  db: Db,
  spaceId: string,
  options: {
    state?: "active" | "accepted" | "expired" | "revoked";
    limit: number;
    offset: number;
  },
) {
  const whereClause = inviteStateWhereClause(options.state);
  const rows = await db
    .select()
    .from(invites)
    .where(whereClause ? and(eq(invites.spaceId, spaceId), whereClause) : eq(invites.spaceId, spaceId))
    .orderBy(desc(invites.createdAt))
    .limit(options.limit + 1)
    .offset(options.offset);
  const hasMore = rows.length > options.limit;
  const visibleRows = hasMore ? rows.slice(0, options.limit) : rows;
  const userIds = [
    ...new Set(
      visibleRows
        .map((invite) => invite.invitedByUserId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const [userMap, joinRows, spaceName] = await Promise.all([
    loadUsersById(db, userIds),
    visibleRows.length
      ? db
          .select({ id: joinRequests.id, inviteId: joinRequests.inviteId })
          .from(joinRequests)
          .where(
            and(
              eq(joinRequests.spaceId, spaceId),
              inArray(
                joinRequests.inviteId,
                visibleRows.map((invite) => invite.id),
              ),
            ),
          )
      : Promise.resolve([]),
    db
      .select({ name: spaces.name })
      .from(spaces)
      .where(eq(spaces.id, spaceId))
      .then((spaceRows) => spaceRows[0]?.name ?? null),
  ]);
  const joinRequestIdByInviteId = new Map(
    joinRows.map((row: { inviteId: string; id: string }) => [row.inviteId, row.id]),
  );

  return {
    invites: visibleRows.map((invite) => ({
      ...invite,
      spaceName,
      humanRole: extractInviteHumanRole(invite),
      inviteMessage: extractInviteMessage(invite),
      state: inviteState(invite),
      invitedByUser: invite.invitedByUserId
        ? userMap.get(invite.invitedByUserId) ?? null
        : null,
      relatedJoinRequestId: joinRequestIdByInviteId.get(invite.id) ?? null,
    })),
    nextOffset: hasMore ? options.offset + options.limit : null,
  };
}

async function loadJoinRequestRecords(db: Db, spaceId: string) {
  const rows = collapseDuplicatePendingHumanJoinRequests(
    await db
      .select()
      .from(joinRequests)
      .where(eq(joinRequests.spaceId, spaceId))
      .orderBy(desc(joinRequests.createdAt))
  );
  const inviteIds = [...new Set(rows.map((row) => row.inviteId))];
  const inviteRows = inviteIds.length
    ? await db
        .select()
        .from(invites)
        .where(inArray(invites.id, inviteIds))
    : [];
  const userIds = [
    ...new Set(
      [
        ...rows.map((row) => row.requestingUserId),
        ...rows.map((row) => row.approvedByUserId),
        ...rows.map((row) => row.rejectedByUserId),
        ...inviteRows.map((invite) => invite.invitedByUserId),
      ].filter((value): value is string => Boolean(value)),
    ),
  ];
  const userMap = await loadUsersById(db, userIds);
  const inviteMap = new Map(inviteRows.map((invite) => [invite.id, invite]));

  return rows.map((row) => {
    const invite = inviteMap.get(row.inviteId) ?? null;
    return {
      ...toJoinRequestResponse(row),
      requesterUser: row.requestingUserId
        ? userMap.get(row.requestingUserId) ?? null
        : null,
      approvedByUser: row.approvedByUserId
        ? userMap.get(row.approvedByUserId) ?? null
        : null,
      rejectedByUser: row.rejectedByUserId
        ? userMap.get(row.rejectedByUserId) ?? null
        : null,
      invite: invite
        ? {
            id: invite.id,
            inviteType: invite.inviteType,
            allowedJoinTypes: invite.allowedJoinTypes,
            humanRole: extractInviteHumanRole(invite),
            inviteMessage: extractInviteMessage(invite),
            createdAt: invite.createdAt,
            expiresAt: invite.expiresAt,
            revokedAt: invite.revokedAt,
            acceptedAt: invite.acceptedAt,
            invitedByUser: invite.invitedByUserId
              ? userMap.get(invite.invitedByUserId) ?? null
              : null,
          }
        : null,
    };
  });
}

async function loadUserSpaceAccessResponse(
  db: Db,
  access: ReturnType<typeof accessService>,
  userId: string,
) {
  const [memberships, user, isInstanceAdmin] = await Promise.all([
    access.listUserSpaceAccess(userId),
    db
      .select({
        id: authUsers.id,
        email: authUsers.email,
        name: authUsers.name,
        image: authUsers.image,
      })
      .from(authUsers)
      .where(eq(authUsers.id, userId))
      .then((rows) => rows[0] ?? null),
    access.isInstanceAdmin(userId),
  ]);
  const spaceIds = [...new Set(memberships.map((membership) => membership.spaceId))];
  const spaceRows = spaceIds.length
    ? await db
        .select({
          id: spaces.id,
          name: spaces.name,
          status: spaces.status,
        })
        .from(spaces)
        .where(inArray(spaces.id, spaceIds))
    : [];
  const spaceMap = new Map(spaceRows.map((space) => [space.id, space]));

  return {
    user: user
      ? {
          ...toUserProfile(user),
          isInstanceAdmin,
        }
      : null,
    spaceAccess: memberships.map((membership) => {
      const space = spaceMap.get(membership.spaceId) ?? null;
      return {
        ...membership,
        principalType: "user" as const,
        spaceName: space?.name ?? null,
        spaceStatus: space?.status ?? null,
      };
    }),
  };
}

function buildOnboardingDiscoveryDiagnostics(input: {
  apiBaseUrl: string;
  deploymentMode: DeploymentMode;
  deploymentExposure: DeploymentExposure;
  bindHost: string;
  allowedHostnames: string[];
}): JoinDiagnostic[] {
  const diagnostics: JoinDiagnostic[] = [];
  let apiHost: string | null = null;
  if (input.apiBaseUrl) {
    try {
      apiHost = normalizeHostname(new URL(input.apiBaseUrl).hostname);
    } catch {
      apiHost = null;
    }
  }

  const bindHost = normalizeHostname(input.bindHost);
  const allowSet = new Set(
    input.allowedHostnames
      .map((entry) => normalizeHostname(entry))
      .filter((entry): entry is string => Boolean(entry))
  );

  if (apiHost && isLoopbackHost(apiHost)) {
    diagnostics.push({
      code: "openclaw_onboarding_api_loopback",
      level: "warn",
      message:
        "Onboarding URL resolves to loopback hostname. Remote OpenClaw agents cannot reach localhost on your Outpost host.",
      hint: "Use a reachable hostname/IP (for example Tailscale hostname, Docker host alias, or public domain)."
    });
  }

  if (
    input.deploymentMode === "authenticated" &&
    input.deploymentExposure === "private" &&
    (!bindHost || isLoopbackHost(bindHost))
  ) {
    diagnostics.push({
      code: "openclaw_onboarding_private_loopback_bind",
      level: "warn",
      message: "Outpost is bound to loopback in authenticated/private mode.",
      hint: "Use a reachable private bind mode such as `pnpm dev --bind lan` or `pnpm dev --bind tailnet` for private-network onboarding."
    });
  }

  if (
    input.deploymentMode === "authenticated" &&
    input.deploymentExposure === "private" &&
    apiHost &&
    !isLoopbackHost(apiHost) &&
    allowSet.size > 0 &&
    !allowSet.has(apiHost)
  ) {
    diagnostics.push({
      code: "openclaw_onboarding_private_host_not_allowed",
      level: "warn",
      message: `Onboarding host "${apiHost}" is not in allowed hostnames for authenticated/private mode.`,
      // `apiHost` comes from the request base URL, so a requester controls it.
      // Never put that value into the guidance command. An operator or an agent
      // can paste the command into a shell, and that outer shell evaluates a
      // metacharacter span in the host before any CLI receives argv. A
      // direct-exec form such as `npx` does not stop the outer shell. Emit
      // a static `<host>` placeholder and keep the raw host in the message only.
      hint: `Run npx @outpost/cli allowed-hostname <host>`
    });
  }

  return diagnostics;
}

function buildOnboardingConnectionCandidates(input: {
  apiBaseUrl: string;
  bindHost: string;
  allowedHostnames: string[];
}): string[] {
  let base: URL | null = null;
  try {
    if (input.apiBaseUrl) {
      base = new URL(input.apiBaseUrl);
    }
  } catch {
    base = null;
  }

  const protocol = base?.protocol ?? "http:";
  const port = base?.port ? `:${base.port}` : "";
  const candidates = new Set<string>();

  if (base) {
    candidates.add(base.origin);
  }

  const bindHost = normalizeHostname(input.bindHost);
  if (bindHost && !isLoopbackHost(bindHost)) {
    candidates.add(`${protocol}//${bindHost}${port}`);
  }

  for (const rawHost of input.allowedHostnames) {
    const host = normalizeHostname(rawHost);
    if (!host) continue;
    candidates.add(`${protocol}//${host}${port}`);
  }

  if (base && isLoopbackHost(base.hostname)) {
    candidates.add(`${protocol}//host.docker.internal${port}`);
  }

  for (const host of collectReachableInterfaceHosts()) {
    const formattedHost = host.includes(":") && !host.startsWith("[") && !host.endsWith("]") ? `[${host}]` : host;
    candidates.add(`${protocol}//${formattedHost}${port}`);
  }

  return Array.from(candidates);
}

function buildInviteOnboardingManifest(
  req: Request,
  token: string,
  invite: typeof invites.$inferSelect,
  opts: {
    spaceName?: string | null;
    deploymentMode: DeploymentMode;
    deploymentExposure: DeploymentExposure;
    bindHost: string;
    allowedHostnames: string[];
    authPublicBaseUrl?: string;
  }
) {
  const baseUrl = resolveBaseUrl(req, opts.authPublicBaseUrl);
  const skillPath = `/api/invites/${token}/skills/outpost`;
  const skillUrl = baseUrl ? `${baseUrl}${skillPath}` : skillPath;
  const registrationEndpointPath = `/api/invites/${token}/accept`;
  const registrationEndpointUrl = baseUrl
    ? `${baseUrl}${registrationEndpointPath}`
    : registrationEndpointPath;
  const onboardingTextPath = `/api/invites/${token}/onboarding.txt`;
  const onboardingTextUrl = baseUrl
    ? `${baseUrl}${onboardingTextPath}`
    : onboardingTextPath;
  const discoveryDiagnostics = buildOnboardingDiscoveryDiagnostics({
    apiBaseUrl: baseUrl,
    deploymentMode: opts.deploymentMode,
    deploymentExposure: opts.deploymentExposure,
    bindHost: opts.bindHost,
    allowedHostnames: opts.allowedHostnames
  });
  const connectionCandidates = buildOnboardingConnectionCandidates({
    apiBaseUrl: baseUrl,
    bindHost: opts.bindHost,
    allowedHostnames: opts.allowedHostnames
  });

  return {
    invite: toInviteSummaryResponse(
      req,
      token,
      invite,
      opts.spaceName ?? null,
      opts.authPublicBaseUrl
    ),
    onboarding: {
      instructions:
        "Join as an external Outpost agent, save your one-time claim secret, wait for operator approval, then claim your Outpost API key through the standard claim endpoint. Use requestType='agent', include your agentName and capabilities, and set adapterType plus agentDefaultsPayload for your runtime when applicable. Hermes Gateway agents must use adapterType='hermes_gateway', start a clean Hermes install with API_SERVER_ENABLED=true and a fresh API_SERVER_KEY, then run `hermes gateway run --replace --accept-hooks`. Put the Hermes gateway URL in agentDefaultsPayload.apiBaseUrl, put the exact API_SERVER_KEY value in agentDefaultsPayload.apiKey, and put the reachable Outpost base URL in agentDefaultsPayload.outpostApiUrl. If you use the default Hermes dashboard root or /chat URL on port 9119, Outpost maps it to /api automatically. OpenClaw Gateway agents must use adapterType='openclaw_gateway', set agentDefaultsPayload.url to a ws:// or wss:// gateway endpoint, and include agentDefaultsPayload.headers.x-openclaw-token." + "\n\n" + EXTERNAL_AGENT_TOOL_GUIDANCE,
      inviteMessage: extractInviteMessage(invite),
      recommendedAdapterType: null,
      requiredFields: {
        requestType: "agent",
        agentName: "Display name for this agent",
        adapterType:
          "Adapter type for this runtime. Use 'openclaw_gateway' only for OpenClaw Gateway agents. Use 'hermes_gateway' only for Hermes Gateway agents.",
        capabilities: "Optional capability summary",
        agentDefaultsPayload:
          "Runtime-specific adapter config. OpenClaw Gateway agents must include url (ws:// or wss://) and headers.x-openclaw-token. Hermes Gateway agents must include apiBaseUrl, apiKey set to the Hermes API_SERVER_KEY, and outpostApiUrl. A default Hermes dashboard root or /chat URL such as http://127.0.0.1:9119/chat is accepted and maps to /api. Other runtimes should include the config their adapter expects."
      },
      registrationEndpoint: {
        method: "POST",
        path: registrationEndpointPath,
        url: registrationEndpointUrl
      },
      claimEndpointTemplate: {
        method: "POST",
        path: "/api/join-requests/{requestId}/claim-api-key",
        body: {
          claimSecret:
            "one-time claim secret returned when the join request is created"
        }
      },
      connectivity: {
        deploymentMode: opts.deploymentMode,
        deploymentExposure: opts.deploymentExposure,
        bindHost: opts.bindHost,
        allowedHostnames: opts.allowedHostnames,
        connectionCandidates,
        diagnostics: discoveryDiagnostics,
        guidance:
          opts.deploymentMode === "authenticated" &&
          opts.deploymentExposure === "private"
            ? "If OpenClaw runs on another machine, ensure the Outpost hostname is reachable and allowed via `npx @outpost/cli allowed-hostname <host>`."
            : "Ensure OpenClaw can reach this Outpost API base URL for invite, claim, and skill bootstrap calls."
      },
      textInstructions: {
        path: onboardingTextPath,
        url: onboardingTextUrl,
        contentType: "text/plain"
      },
      skill: {
        name: "outpost",
        path: skillPath,
        url: skillUrl,
        installPath: "runtime-specific Outpost skill location"
      }
    }
  };
}

export function buildInviteOnboardingTextDocument(
  req: Request,
  token: string,
  invite: typeof invites.$inferSelect,
  opts: {
    spaceName?: string | null;
    deploymentMode: DeploymentMode;
    deploymentExposure: DeploymentExposure;
    bindHost: string;
    allowedHostnames: string[];
    authPublicBaseUrl?: string;
  }
) {
  const manifest = buildInviteOnboardingManifest(req, token, invite, opts);
  const onboarding = manifest.onboarding as {
    inviteMessage?: string | null;
    registrationEndpoint: { method: string; path: string; url: string };
    claimEndpointTemplate: { method: string; path: string };
    textInstructions: { path: string; url: string };
    skill: { path: string; url: string; installPath: string };
    connectivity: {
      diagnostics?: JoinDiagnostic[];
      guidance?: string;
      connectionCandidates?: string[];
      testResolutionEndpoint?: { method?: string; path?: string; url?: string };
    };
  };
  const diagnostics = Array.isArray(onboarding.connectivity?.diagnostics)
    ? onboarding.connectivity.diagnostics
    : [];

  const lines: string[] = [];
  const appendBlock = (block: string) => {
    const trimmed = block.replace(/^\n/, "").replace(/\n\s*$/, "");
    const lineIndentation = trimmed
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => line.match(/^(\s*)/)?.[0].length ?? 0);
    const minIndent =
      lineIndentation.length > 0 ? Math.min(...lineIndentation) : 0;
    for (const line of trimmed.split("\n")) {
      lines.push(line.slice(minIndent));
    }
  };

  appendBlock(`
    # Outpost Agent Onboarding

    This document is meant to be readable by both humans and agents.

    ## Invite
    - inviteType: ${invite.inviteType}
    - allowedJoinTypes: ${invite.allowedJoinTypes}
    - expiresAt: ${invite.expiresAt.toISOString()}
  `);

  if (manifest.invite.spaceName) {
    lines.push(`- spaceName: ${manifest.invite.spaceName}`);
  }

  if (onboarding.inviteMessage) {
    appendBlock(`
      ## Message from inviter
      ${onboarding.inviteMessage}
    `);
  }

  appendBlock(`
    ## Step 0

    Decide which Outpost adapter type matches your runtime.

    Use adapterType only when there is a matching Outpost adapter. Put runtime-specific settings in agentDefaultsPayload.

    ## Step 1: Submit agent join request
    ${onboarding.registrationEndpoint.method} ${
    onboarding.registrationEndpoint.url
  }

    Body (JSON):
    {
      "requestType": "agent",
      "agentName": "My Agent",
      "adapterType": "adapter_type_for_this_runtime",
      "capabilities": "Short summary of what this agent can do",
      "agentDefaultsPayload": {}
    }

    OpenClaw Gateway payload example:
    {
      "requestType": "agent",
      "agentName": "My OpenClaw Agent",
      "adapterType": "openclaw_gateway",
      "capabilities": "OpenClaw gateway agent",
      "agentDefaultsPayload": {
        "url": "wss://your-openclaw-gateway.example",
        "outpostApiUrl": "https://outpost-hostname-your-agent-can-reach:3100",
        "headers": { "x-openclaw-token": "replace-me" },
        "waitTimeoutMs": 120000,
        "sessionKeyStrategy": "issue",
        "role": "operator",
        "scopes": ["operator.admin"]
      }
    }

    For OpenClaw Gateway, include agentDefaultsPayload.headers.x-openclaw-token with your gateway token. Legacy x-openclaw-auth is also accepted, but x-openclaw-token is preferred. Do NOT use /v1/responses or /hooks/* in this gateway join flow.

    Hermes Gateway setup:
    - adapterType: "hermes_gateway"
    - For a clean Hermes install, generate a fresh random gateway key and start Hermes with API_SERVER_ENABLED=true and API_SERVER_KEY=<random-gateway-key>.
    - Run: hermes gateway run --replace --accept-hooks
    - Default Hermes API server port: 8642.
    - Set agentDefaultsPayload.apiBaseUrl to the Hermes gateway URL Outpost can reach.
    - Set agentDefaultsPayload.apiKey to the exact same value as API_SERVER_KEY. This is the Hermes gateway key, not the Outpost key.
    - If you only have the default Hermes dashboard or chat URL, http://127.0.0.1:9119 and http://127.0.0.1:9119/chat are accepted and map to /api automatically.
    - Watch out: /chat and the dashboard root are browser UI routes. Outpost tests /api/health and starts runs with /api/v1/runs after mapping them to the API base.
    - Set agentDefaultsPayload.outpostApiUrl to the Outpost base URL Hermes can reach.
    - Use hermes_local when Outpost should start Hermes on the Outpost host.
    - Use hermes_gateway when Outpost should call an already-running Hermes API server.
    - After operator approval, claim the Outpost API key once with the claim endpoint below and save it as OUTPOST_API_KEY. Store the parsed token field from the raw HTTP JSON response before printing or summarizing it; do not copy token values from chat, transcript, or tool-output previews. A token value containing literal ... or [redacted] is a masked display preview, not a valid key. Do not rotate or invent an Outpost key manually.
    - Hermes-originated Outpost API usage means Hermes calls Outpost with OUTPOST_API_URL and OUTPOST_API_KEY after approval/key claim. Do not confuse that with agentDefaultsPayload.apiBaseUrl, which points Outpost to Hermes.

    Hermes Gateway payload example:
    {
      "requestType": "agent",
      "agentName": "My Hermes Gateway Agent",
      "adapterType": "hermes_gateway",
      "capabilities": "Hermes gateway agent",
      "agentDefaultsPayload": {
        "apiBaseUrl": "http://127.0.0.1:8642",
        "apiKey": "<same-value-as-API_SERVER_KEY>",
        "outpostApiUrl": "http://localhost:3100"
      }
    }

    Hermes Gateway network examples:
    - Local loopback API server: agentDefaultsPayload.apiBaseUrl = "http://127.0.0.1:8642" and agentDefaultsPayload.outpostApiUrl = "http://127.0.0.1:3100".
    - Local loopback dashboard root or chat URL: agentDefaultsPayload.apiBaseUrl = "http://127.0.0.1:9119" or "http://127.0.0.1:9119/chat"; Outpost maps either one to "http://127.0.0.1:9119/api".
    - LAN/private network: use reachable private addresses, for example agentDefaultsPayload.apiBaseUrl = "http://192.168.1.25:8642" and agentDefaultsPayload.outpostApiUrl = "http://192.168.1.10:3100".
    - Private overlay: use overlay DNS names, for example agentDefaultsPayload.apiBaseUrl = "http://hermes-host.tailnet-name.ts.net:8642" and agentDefaultsPayload.outpostApiUrl = "http://outpost-host.tailnet-name.ts.net:3100".
    - Docker: if Outpost runs in Docker and Hermes runs on the host, use agentDefaultsPayload.apiBaseUrl = "http://host.docker.internal:8642"; if both run in Compose, use the Hermes service name.
    - Reverse proxy/TLS: use HTTPS origins, for example agentDefaultsPayload.apiBaseUrl = "https://hermes-gateway.example" and agentDefaultsPayload.outpostApiUrl = "https://outpost.example".

    Expected response includes:
    - request id
    - one-time claimSecret
    - claimApiKeyPath

    ## Step 2: Wait for operator approval
    The operator approves the join request in Outpost before key claim is allowed.

    ## Step 3: Claim API key (one-time)
    ${
      onboarding.claimEndpointTemplate.method
    } /api/join-requests/{requestId}/claim-api-key

    Body (JSON):
    {
      "claimSecret": "<one-time-claim-secret>"
    }

    On successful claim, save the full JSON response somewhere private for your runtime and set OUTPOST_API_KEY and OUTPOST_API_URL for future Outpost API calls. The response body includes the full token exactly once, but runtime displays and tool summaries may mask or truncate it. Write the raw response token directly to private storage before logging anything, then verify it with an authenticated Outpost API call. Do not persist displayed previews containing literal ... or [redacted].

    Important:
    - claim secrets expire
    - claim secrets are single-use
    - claim fails before operator approval

    ## Step 4: Install Outpost skill
    GET ${onboarding.skill.url}
    Install path: ${onboarding.skill.installPath}

    Use your runtime's normal skill or instruction installation path.

    ## Working through Outpost
    ${EXTERNAL_AGENT_TOOL_GUIDANCE}

    ## Text onboarding URL
    ${onboarding.textInstructions.url}

    ## Connectivity guidance
    ${
      onboarding.connectivity?.guidance ??
      "Ensure Outpost is reachable from your OpenClaw runtime."
    }
  `);

  const connectionCandidates = Array.isArray(
    onboarding.connectivity?.connectionCandidates
  )
    ? onboarding.connectivity.connectionCandidates.filter(
        (entry): entry is string => Boolean(entry)
      )
    : [];

  if (connectionCandidates.length > 0) {
    lines.push("## Suggested Outpost base URLs to try");
    for (const candidate of connectionCandidates) {
      lines.push(`- ${candidate}`);
    }
    appendBlock(`

      Test each candidate with:
      - GET <candidate>/api/health
      - set the first reachable candidate as agentDefaultsPayload.outpostApiUrl when submitting your join request

      If none are reachable: ask your human operator for a reachable hostname/address and help them update network configuration.
      For authenticated/private mode, they may need:
      - npx @outpost/cli allowed-hostname <host>
      - then restart Outpost and retry onboarding.
    `);
  }

  if (diagnostics.length > 0) {
    lines.push("## Connectivity diagnostics");
    for (const diag of diagnostics) {
      lines.push(`- [${diag.level}] ${diag.message}`);
      if (diag.hint) lines.push(`  hint: ${diag.hint}`);
    }
  }

  appendBlock(`

    ## Helpful endpoints
    ${onboarding.registrationEndpoint.path}
    ${onboarding.claimEndpointTemplate.path}
    ${onboarding.skill.path}
    ${manifest.invite.onboardingPath}
  `);

  return `${lines.join("\n")}\n`;
}

function extractInviteMessage(
  invite: typeof invites.$inferSelect
): string | null {
  const rawDefaults = invite.defaultsPayload;
  if (
    !rawDefaults ||
    typeof rawDefaults !== "object" ||
    Array.isArray(rawDefaults)
  ) {
    return null;
  }
  const rawMessage = (rawDefaults as Record<string, unknown>).agentMessage;
  if (typeof rawMessage !== "string") {
    return null;
  }
  const trimmed = rawMessage.trim();
  return trimmed.length ? trimmed : null;
}

function mergeInviteDefaults(
  defaultsPayload: Record<string, unknown> | null | undefined,
  agentMessage: string | null,
  humanRole: "owner" | "admin" | "operator" | "viewer" | null = null,
): Record<string, unknown> | null {
  const merged =
    defaultsPayload && typeof defaultsPayload === "object"
      ? { ...defaultsPayload }
      : {};
  if (humanRole) {
    const existingHuman =
      isPlainObject(merged.human) ? { ...(merged.human as Record<string, unknown>) } : {};
    merged.human = {
      ...existingHuman,
      role: humanRole,
      grants: grantsForHumanRole(humanRole),
    };
  }
  if (agentMessage) {
    merged.agentMessage = agentMessage;
  }
  return Object.keys(merged).length ? merged : null;
}

function requestIp(req: Request) {
  const forwarded = req.header("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.ip || "unknown";
}

function inviteExpired(invite: typeof invites.$inferSelect) {
  return invite.expiresAt.getTime() <= Date.now();
}

function inviteState(invite: typeof invites.$inferSelect) {
  if (invite.revokedAt) return "revoked" as const;
  if (invite.acceptedAt) return "accepted" as const;
  if (inviteExpired(invite)) return "expired" as const;
  return "active" as const;
}

function extractInviteHumanRole(invite: typeof invites.$inferSelect) {
  if (invite.allowedJoinTypes === "agent") return null;
  return resolveHumanInviteRole(
    invite.defaultsPayload as Record<string, unknown> | null | undefined,
  );
}

function isLocalImplicit(req: Request) {
  return req.actor.type === "operator" && req.actor.source === "local_implicit";
}

function toUserProfile(
  user:
    | {
      id: string;
      email: string | null;
      name: string | null;
      image?: string | null;
    }
    | null
    | undefined,
) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email ?? null,
    name: user.name ?? null,
    image: user.image ?? null,
  };
}

async function resolveActorEmail(db: Db, req: Request): Promise<string | null> {
  if (isLocalImplicit(req)) return "local@outpost.local";
  const userId = req.actor.userId;
  if (!userId) return null;
  const user = await db
    .select({ email: authUsers.email })
    .from(authUsers)
    .where(eq(authUsers.id, userId))
    .then((rows) => rows[0] ?? null);
  return user?.email ?? null;
}

async function resolveAcceptedInviteJoinRequest(
  db: Db,
  req: Request,
  invite: typeof invites.$inferSelect | null,
) {
  if (!invite?.acceptedAt) return null;

  const directJoinRequest = await db
    .select({
      requestType: joinRequests.requestType,
      status: joinRequests.status,
      requestingUserId: joinRequests.requestingUserId,
      requestEmailSnapshot: joinRequests.requestEmailSnapshot,
    })
    .from(joinRequests)
    .where(eq(joinRequests.inviteId, invite.id))
    .then((rows) => rows[0] ?? null);
  if (directJoinRequest) return directJoinRequest;

  if (!invite.spaceId) return null;

  const actorRequestingUserId = isLocalImplicit(req)
    ? "local-operator"
    : req.actor.userId ?? null;
  const actorEmail = await resolveActorEmail(db, req);
  if (!actorRequestingUserId && !actorEmail) return null;

  return findReusableHumanJoinRequest(
    await db
      .select({
        id: joinRequests.id,
        requestType: joinRequests.requestType,
        status: joinRequests.status,
        requestingUserId: joinRequests.requestingUserId,
        requestEmailSnapshot: joinRequests.requestEmailSnapshot,
      })
      .from(joinRequests)
      .where(
        and(
          eq(joinRequests.spaceId, invite.spaceId),
          eq(joinRequests.requestType, "human"),
        ),
      )
      .orderBy(desc(joinRequests.createdAt)),
    {
      requestingUserId: actorRequestingUserId,
      requestEmailSnapshot: actorEmail,
    },
  );
}

function grantsFromDefaults(
  defaultsPayload: Record<string, unknown> | null | undefined,
  key: "human" | "agent"
): Array<{
  permissionKey: (typeof PERMISSION_KEYS)[number];
  scope: Record<string, unknown> | null;
}> {
  if (!defaultsPayload || typeof defaultsPayload !== "object") return [];
  const scoped = defaultsPayload[key];
  if (!scoped || typeof scoped !== "object") return [];
  const grants = (scoped as Record<string, unknown>).grants;
  if (!Array.isArray(grants)) return [];
  const validPermissionKeys = new Set<string>(PERMISSION_KEYS);
  const result: Array<{
    permissionKey: (typeof PERMISSION_KEYS)[number];
    scope: Record<string, unknown> | null;
  }> = [];
  for (const item of grants) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.permissionKey !== "string") continue;
    if (!validPermissionKeys.has(record.permissionKey)) continue;
    result.push({
      permissionKey: record.permissionKey as (typeof PERMISSION_KEYS)[number],
      scope:
        record.scope &&
        typeof record.scope === "object" &&
        !Array.isArray(record.scope)
          ? (record.scope as Record<string, unknown>)
          : null
    });
  }
  return result;
}

export function agentJoinGrantsFromDefaults(
  defaultsPayload: Record<string, unknown> | null | undefined,
  agentId: string,
): Array<{
  permissionKey: (typeof PERMISSION_KEYS)[number];
  scope: Record<string, unknown> | null;
}> {
  return standardAgentJoinGrantsFromDefaults(defaultsPayload, agentId);
}

type JoinRequestLeadCandidate = {
  id: string;
  role: string;
  leadAgentId: string | null;
};

export function resolveJoinRequestLeadAgentId(
  candidates: JoinRequestLeadCandidate[],
  defaultAgentId?: string | null,
): string | null {
  const primary = defaultAgentId
    ? candidates.find((candidate) => candidate.id === defaultAgentId)
    : null;
  if (primary) return primary.id;

  const rootPeer = candidates.find((candidate) => candidate.leadAgentId === null);
  return (rootPeer ?? candidates[0] ?? null)?.id ?? null;
}

function isInviteTokenHashCollisionError(error: unknown) {
  const candidates = [
    error,
    (error as { cause?: unknown } | null)?.cause ?? null
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const code =
      "code" in candidate && typeof candidate.code === "string"
        ? candidate.code
        : null;
    const message =
      "message" in candidate && typeof candidate.message === "string"
        ? candidate.message
        : "";
    const constraint =
      "constraint" in candidate && typeof candidate.constraint === "string"
        ? candidate.constraint
        : null;
    if (code !== "23505") continue;
    if (constraint === "invites_token_hash_unique_idx") return true;
    if (message.includes("invites_token_hash_unique_idx")) return true;
  }
  return false;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

type InviteResolutionProbe = {
  status: "reachable" | "timeout" | "unreachable";
  method: "HEAD";
  durationMs: number;
  httpStatus: number | null;
  message: string;
};

type InviteResolutionLookupResult = {
  address: string;
  family?: number;
};

type ResolvedInviteResolutionTarget = {
  url: URL;
  resolvedAddress: string;
  resolvedAddresses: string[];
  hostHeader: string;
  tlsServername?: string;
};

type InviteResolutionHeadResponse = {
  httpStatus: number | null;
};

type InviteResolutionNetwork = {
  lookup(hostname: string): Promise<InviteResolutionLookupResult[]>;
  requestHead(
    target: ResolvedInviteResolutionTarget,
    timeoutMs: number
  ): Promise<InviteResolutionHeadResponse>;
};

function parseIpv4Address(address: string) {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const parsed = parts.map((part) => {
    if (!/^\d+$/.test(part)) return NaN;
    return Number(part);
  });
  if (parsed.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parsed as [number, number, number, number];
}

function isPrivateOrReservedIpv4(address: string) {
  const octets = parseIpv4Address(address);
  if (!octets) return true;
  const [a, b, c] = octets;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 192 && b === 88 && c === 99) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function parseMappedIpv4Hex(address: string) {
  const match = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!match) return null;
  const hi = Number.parseInt(match[1]!, 16);
  const lo = Number.parseInt(match[2]!, 16);
  if (!Number.isInteger(hi) || !Number.isInteger(lo)) return null;
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

function isPrivateOrReservedIpv6(address: string) {
  const lower = address.toLowerCase();
  if (lower.startsWith("::ffff:")) {
    const mappedIpv4 = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mappedIpv4?.[1]) return isPrivateOrReservedIpv4(mappedIpv4[1]);
    const mappedIpv4Hex = parseMappedIpv4Hex(lower);
    if (mappedIpv4Hex) return isPrivateOrReservedIpv4(mappedIpv4Hex);
    return true;
  }
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(lower)) return true;
  if (lower.startsWith("ff")) return true;
  if (lower === "100::" || lower.startsWith("100:")) return true;
  if (lower.startsWith("2001:db8:") || lower === "2001:db8::") return true;
  if (lower.startsWith("2001:2:") || lower === "2001:2::") return true;
  if (lower.startsWith("2002:")) return true;
  if (lower.startsWith("64:ff9b:")) return true;
  return false;
}

function isPublicIpAddress(address: string) {
  const ipVersion = isIP(address);
  if (ipVersion === 4) return !isPrivateOrReservedIpv4(address);
  if (ipVersion === 6) return !isPrivateOrReservedIpv6(address);
  return false;
}

function hostnameForResolution(url: URL) {
  return url.hostname.replace(/^\[|\]$/g, "");
}

async function defaultInviteResolutionLookup(
  hostname: string
): Promise<InviteResolutionLookupResult[]> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

async function defaultInviteResolutionHeadRequest(
  target: ResolvedInviteResolutionTarget,
  timeoutMs: number
): Promise<InviteResolutionHeadResponse> {
  return new Promise((resolve, reject) => {
    const url = target.url;
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const options: HttpRequestOptions & { servername?: string } = {
      protocol: url.protocol,
      hostname: target.resolvedAddress,
      port: url.port || undefined,
      method: "HEAD",
      path: `${url.pathname}${url.search}`,
      headers: {
        Host: target.hostHeader
      }
    };
    if (target.tlsServername) {
      options.servername = target.tlsServername;
    }

    let settled = false;
    const req = request(options, (response: IncomingMessage) => {
      settled = true;
      response.resume();
      resolve({ httpStatus: response.statusCode ?? null });
    });
    req.setTimeout(timeoutMs, () => {
      if (settled) return;
      const error = new Error("Invite resolution probe timed out");
      error.name = "AbortError";
      req.destroy(error);
    });
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    req.end();
  });
}

const defaultInviteResolutionNetwork: InviteResolutionNetwork = {
  lookup: defaultInviteResolutionLookup,
  requestHead: defaultInviteResolutionHeadRequest
};

let inviteResolutionNetwork = defaultInviteResolutionNetwork;

export function setInviteResolutionNetworkForTest(
  network: Partial<InviteResolutionNetwork> | null
) {
  inviteResolutionNetwork = network
    ? { ...defaultInviteResolutionNetwork, ...network }
    : defaultInviteResolutionNetwork;
}

async function lookupInviteResolutionHostname(
  hostname: string,
  network: InviteResolutionNetwork = inviteResolutionNetwork
) {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      network.lookup(hostname),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              badRequest(
                `url hostname DNS lookup timed out after ${INVITE_RESOLUTION_DNS_TIMEOUT_MS}ms`
              )
            ),
          INVITE_RESOLUTION_DNS_TIMEOUT_MS
        );
      })
    ]);
  } catch (error) {
    if (error instanceof Error && "status" in error) throw error;
    throw badRequest("url hostname could not be resolved");
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function resolveInviteResolutionTarget(
  url: URL,
  network: InviteResolutionNetwork = inviteResolutionNetwork
): Promise<ResolvedInviteResolutionTarget> {
  const hostname = hostnameForResolution(url);
  if (parseIpv4Address(hostname)) {
    if (!isPublicIpAddress(hostname)) {
      throw badRequest(
        "url resolves to a private, local, multicast, or reserved address"
      );
    }
    return {
      url,
      resolvedAddress: hostname,
      resolvedAddresses: [hostname],
      hostHeader: url.host,
      tlsServername: undefined,
    };
  }
  const literalIpVersion = isIP(hostname);
  if (literalIpVersion !== 0) {
    if (!isPublicIpAddress(hostname)) {
      throw badRequest(
        "url resolves to a private, local, multicast, or reserved address"
      );
    }
    return {
      url,
      resolvedAddress: hostname,
      resolvedAddresses: [hostname],
      hostHeader: url.host,
      tlsServername: undefined,
    };
  }
  const results = await lookupInviteResolutionHostname(hostname, network);
  if (results.length === 0) {
    throw badRequest("url hostname did not resolve to any addresses");
  }

  const resolvedAddresses = results.map((result) => result.address);
  const unsafeAddress = resolvedAddresses.find((address) => !isPublicIpAddress(address));
  if (unsafeAddress) {
    throw badRequest(
      "url resolves to a private, local, multicast, or reserved address"
    );
  }

  return {
    url,
    resolvedAddress: resolvedAddresses[0]!,
    resolvedAddresses,
    hostHeader: url.host,
    tlsServername: url.protocol === "https:" && isIP(hostname) === 0
      ? hostname
      : undefined
  };
}

async function probeInviteResolutionTarget(
  target: ResolvedInviteResolutionTarget,
  timeoutMs: number,
  network: InviteResolutionNetwork = inviteResolutionNetwork
): Promise<InviteResolutionProbe> {
  const startedAt = Date.now();
  try {
    const response = await network.requestHead(target, timeoutMs);
    const durationMs = Date.now() - startedAt;
    if (
      response.httpStatus !== null &&
      (
        (response.httpStatus >= 200 && response.httpStatus < 300) ||
        response.httpStatus === 401 ||
        response.httpStatus === 403 ||
        response.httpStatus === 404 ||
        response.httpStatus === 405 ||
        response.httpStatus === 422 ||
        response.httpStatus === 500 ||
        response.httpStatus === 501
      )
    ) {
      return {
        status: "reachable",
        method: "HEAD",
        durationMs,
        httpStatus: response.httpStatus,
        message: `Webhook endpoint responded to HEAD with HTTP ${response.httpStatus}.`
      };
    }
    return {
      status: "unreachable",
      method: "HEAD",
      durationMs,
      httpStatus: response.httpStatus,
      message: response.httpStatus === null
        ? "Webhook endpoint probe did not return an HTTP status."
        : `Webhook endpoint probe returned HTTP ${response.httpStatus}.`
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    if (isAbortError(error)) {
      return {
        status: "timeout",
        method: "HEAD",
        durationMs,
        httpStatus: null,
        message: `Webhook endpoint probe timed out after ${timeoutMs}ms.`
      };
    }
    return {
      status: "unreachable",
      method: "HEAD",
      durationMs,
      httpStatus: null,
      message:
        error instanceof Error
          ? error.message
          : "Webhook endpoint probe failed."
    };
  }
}

export function accessRoutes(
  db: Db,
  opts: {
    deploymentMode: DeploymentMode;
    deploymentExposure: DeploymentExposure;
    bindHost: string;
    allowedHostnames: string[];
    inviteResolutionNetwork?: Partial<InviteResolutionNetwork>;
    inviteRateLimiter?: InviteRateLimiter;
    cliAuthCreateRateLimiter?: InviteRateLimiter;
    cliAuthPollRateLimiter?: InviteRateLimiter;
    authPublicBaseUrl?: string;
  }
) {
  const router = Router();
  const access = accessService(db);
  const operatorAuth = operatorAuthService(db);
  const agents = agentService(db);
  const agentsLifecycle = createAgentLifecycle(db);
  const routeInviteResolutionNetwork = opts.inviteResolutionNetwork
    ? { ...defaultInviteResolutionNetwork, ...opts.inviteResolutionNetwork }
    : inviteResolutionNetwork;

  // Per-IP rate limit for the public, unauthenticated invite-token endpoints
  // (`/invites/:token*`). The token is looked up by hash, so without a limit the
  // token space would be online-enumerable. Applied as a router-level middleware
  // so every current and future `/invites/:token` sub-route is covered.
  //
  // The key is deliberately NOT `requestIp()`: that helper prefers the
  // client-supplied `X-Forwarded-For` header (fine for log/audit fields,
  // but trivially spoofable as a rate-limit key — rotating fake XFF values
  // would mint a fresh budget per request). `req.ip` honors Express's
  // `trust proxy` setting (configured from TRUST_PROXY in app.ts, default:
  // trust nothing), so it is the socket's remote address unless the
  // operator explicitly trusts a proxy — an unforgeable key either way.
  const inviteRateLimiter = opts.inviteRateLimiter ?? createInviteRateLimiter();
  router.use("/invites/:token", (req, res, next) => {
    const result = inviteRateLimiter.consume(
      req.ip || req.socket?.remoteAddress || "unknown",
    );
    res.setHeader("X-RateLimit-Limit", String(result.limit));
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));
    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
      next(
        tooManyRequests("Too many invite requests", {
          retryAfterSeconds: result.retryAfterSeconds,
        }),
      );
      return;
    }
    next();
  });

  const cliAuthCreateRateLimiter = opts.cliAuthCreateRateLimiter ?? createInviteRateLimiter();
  const cliAuthPollRateLimiter = opts.cliAuthPollRateLimiter ?? createInviteRateLimiter({ maxRequests: 120 });
  const limitCliAuth = (limiter: InviteRateLimiter) => (req: Request, res: Response, next: NextFunction) => {
    const result = limiter.consume(req.ip || req.socket?.remoteAddress || "unknown");
    res.setHeader("X-RateLimit-Limit", String(result.limit));
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));
    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
      next(tooManyRequests("Too many CLI auth requests", { retryAfterSeconds: result.retryAfterSeconds }));
      return;
    }
    next();
  };
  router.use("/cli-auth/challenges", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  async function assertInstanceAdmin(req: Request) {
    if (req.actor.type !== "operator") throw unauthorized();
    if (isLocalImplicit(req)) return;
    const allowed = await access.isInstanceAdmin(req.actor.userId);
    if (!allowed) throw forbidden("Instance admin required");
  }

  router.get("/operator-claim/:token", async (req, res) => {
    const token = (req.params.token as string).trim();
    const code =
      typeof req.query.code === "string" ? req.query.code.trim() : undefined;
    if (!token) throw notFound("Operator claim challenge not found");
    const challenge = inspectOperatorClaimChallenge(token, code);
    if (challenge.status === "invalid")
      throw notFound("Operator claim challenge not found");
    res.json(challenge);
  });

  router.post("/operator-claim/:token/claim", async (req, res) => {
    const token = (req.params.token as string).trim();
    const code =
      typeof req.body?.code === "string" ? req.body.code.trim() : undefined;
    if (!token) throw notFound("Operator claim challenge not found");
    if (!code) throw badRequest("Claim code is required");
    if (
      req.actor.type !== "operator" ||
      req.actor.source !== "session" ||
      !req.actor.userId
    ) {
      throw unauthorized("Sign in before claiming operator ownership");
    }

    const claimed = await claimOperatorOwnership(db, {
      token,
      code,
      userId: req.actor.userId
    });

    if (claimed.status === "invalid")
      throw notFound("Operator claim challenge not found");
    if (claimed.status === "expired")
      throw conflict(
        "Operator claim challenge expired. Restart server to generate a new one."
      );
    if (claimed.status === "claimed") {
      res.json({
        claimed: true,
        userId: claimed.claimedByUserId ?? req.actor.userId
      });
      return;
    }

    throw conflict("Operator claim challenge is no longer available");
  });

  router.post("/bootstrap/claim", async (req, res) => {
    if (
      opts.deploymentMode !== "authenticated" ||
      opts.deploymentExposure !== "private"
    ) {
      throw notFound("Browser first-admin claim is not available");
    }
    if (
      req.actor.type !== "operator" ||
      req.actor.source !== "session" ||
      !req.actor.userId
    ) {
      throw unauthorized("Sign in from a browser session before claiming first admin");
    }

    const claimed = await claimFirstInstanceAdmin(db, {
      userId: req.actor.userId,
    });
    if (claimed.status === "already_claimed") {
      throw conflict("Someone else has already claimed this instance");
    }

    res.json({ claimed: true, userId: claimed.userId });
  });

  router.post(
    "/cli-auth/challenges",
    limitCliAuth(cliAuthCreateRateLimiter),
    validate(createCliAuthChallengeSchema),
    async (req, res) => {
      const created = await operatorAuth.createCliAuthChallenge(req.body);
      const approvalPath = buildCliAuthApprovalPath(
        created.challenge.id,
        created.challengeSecret,
      );
      const baseUrl = resolveBaseUrl(req, opts.authPublicBaseUrl);
      res.status(201).json({
        id: created.challenge.id,
        token: created.challengeSecret,
        operatorApiToken: created.pendingOperatorToken,
        approvalPath,
        approvalUrl: baseUrl ? `${baseUrl}${approvalPath}` : null,
        pollPath: `/cli-auth/challenges/${created.challenge.id}`,
        expiresAt: created.challenge.expiresAt.toISOString(),
        suggestedPollIntervalMs: 1000,
      });
    },
  );

  router.get("/cli-auth/challenges/:id", limitCliAuth(cliAuthPollRateLimiter), async (req, res) => {
    const id = (req.params.id as string).trim();
    const token =
      typeof req.query.token === "string" ? req.query.token.trim() : "";
    if (!id || !token) throw notFound("CLI auth challenge not found");
    if (!isUuidLike(id)) throw badRequest("Invalid CLI auth challenge ID");
    const challenge = await operatorAuth.describeCliAuthChallenge(id, token, {
      viewerUserId: req.actor.type === "operator" ? req.actor.userId : undefined,
    });
    if (!challenge) throw notFound("CLI auth challenge not found");

    const isSignedInOperatorUser =
      req.actor.type === "operator" &&
      (req.actor.source === "session" || req.actor.source === "cloud_tenant" || isLocalImplicit(req)) &&
      Boolean(req.actor.userId);
    const canApprove =
      isSignedInOperatorUser &&
      (!challenge.requestedSpaceId || Boolean(req.actor.isInstanceAdmin) || isLocalImplicit(req)
        || Boolean(req.actor.spaceIds?.includes(challenge.requestedSpaceId))) &&
      (challenge.requestedAccess !== "instance_admin_required" ||
        isLocalImplicit(req) ||
        Boolean(req.actor.isInstanceAdmin));

    res.json({
      ...challenge,
      requiresSignIn: !isSignedInOperatorUser,
      canApprove,
      currentUserId: req.actor.type === "operator" ? req.actor.userId ?? null : null,
    });
  });

  router.post(
    "/cli-auth/challenges/:id/approve",
    validate(resolveCliAuthChallengeSchema),
    async (req, res) => {
      const id = (req.params.id as string).trim();
      if (
        req.actor.type !== "operator" ||
        (!req.actor.userId && !isLocalImplicit(req))
      ) {
        throw unauthorized("Sign in before approving CLI access");
      }
      if (!isUuidLike(id)) throw badRequest("Invalid CLI auth challenge ID");

      const userId = req.actor.userId ?? "local-operator";
      const approved = await operatorAuth.approveCliAuthChallenge(
        id,
        req.body.token,
        userId,
      );

      res.json({
        approved: approved.status === "approved",
        status: approved.status,
        userId,
        keyId: approved.challenge.operatorApiKeyId ?? null,
        expiresAt: approved.challenge.expiresAt.toISOString(),
      });
    },
  );

  router.post(
    "/cli-auth/challenges/:id/cancel",
    validate(resolveCliAuthChallengeSchema),
    async (req, res) => {
      const id = (req.params.id as string).trim();
      if (!isUuidLike(id)) throw badRequest("Invalid CLI auth challenge ID");
      const cancelled = await operatorAuth.cancelCliAuthChallenge(id, req.body.token);
      res.json({
        status: cancelled.status,
        cancelled: cancelled.status === "cancelled",
      });
    },
  );

  router.get("/cli-auth/me", async (req, res) => {
    if (req.actor.type !== "operator" || !req.actor.userId) {
      throw unauthorized("Operator authentication required");
    }
    const accessSnapshot = await operatorAuth.resolveOperatorAccess(req.actor.userId);
    res.json({
      user: accessSnapshot.user,
      userId: req.actor.userId,
      isInstanceAdmin: accessSnapshot.isInstanceAdmin,
      spaceIds: accessSnapshot.spaceIds,
      memberships: accessSnapshot.memberships,
      source: req.actor.source ?? "none",
      keyId: req.actor.source === "operator_key" ? req.actor.keyId ?? null : null,
    });
  });

  router.get("/operator-api-keys", async (req, res) => {
    if (req.actor.type !== "operator" || !req.actor.userId) {
      throw unauthorized("Operator authentication required");
    }
    const keys = await operatorAuth.listOperatorApiKeys(req.actor.userId, {
      includeInactive: req.query.includeInactive === "true",
    });
    res.json(keys);
  });

  router.post(
    "/operator-api-keys",
    validate(createOperatorApiKeySchema),
    async (req, res) => {
      if (req.actor.type !== "operator" || !req.actor.userId) {
        throw unauthorized("Operator authentication required");
      }

      if (req.body.requestedSpaceId) {
        assertSpaceAccess(req, req.body.requestedSpaceId);
      }

      const key = await operatorAuth.createNamedOperatorApiKey({
        userId: req.actor.userId,
        name: req.body.name,
        expiresAt: req.body.expiresAt === undefined ? undefined : req.body.expiresAt,
      });
      const spaceIds = await operatorAuth.resolveOperatorActivitySpaceIds({
        userId: req.actor.userId,
        requestedSpaceId: req.body.requestedSpaceId ?? null,
        operatorApiKeyId: key.id,
      });
      for (const spaceId of spaceIds) {
        await logActivity(db, {
          spaceId,
          actorType: "user",
          actorId: req.actor.userId,
          action: "operator_api_key.created",
          entityType: "user",
          entityId: req.actor.userId,
          details: {
            operatorApiKeyId: key.id,
            name: key.name,
            requestedSpaceId: req.body.requestedSpaceId ?? null,
            expiresAt: key.expiresAt?.toISOString() ?? null,
          },
        });
      }

      res.status(201).json(key);
    },
  );

  router.delete("/operator-api-keys/:keyId", async (req, res) => {
    if (req.actor.type !== "operator" || !req.actor.userId) {
      throw unauthorized("Operator authentication required");
    }
    const keyId = (req.params.keyId as string).trim();
    if (!isUuidLike(keyId)) {
      throw badRequest("Invalid operator API key ID");
    }
    const key = await operatorAuth.getOperatorApiKeyForUser(keyId, req.actor.userId);
    if (!key) throw notFound("Operator API key not found");
    const revoked = await operatorAuth.revokeOperatorApiKey(key.id, { userId: req.actor.userId, revokedVia: "operator_api_key_lifecycle" });
    if (!revoked) throw notFound("Operator API key not found");

    res.json({ ok: true, keyId: key.id });
  });

  router.post("/cli-auth/revoke-current", async (req, res) => {
    if (req.actor.type !== "operator" || req.actor.source !== "operator_key") {
      throw badRequest("Current operator API key context is required");
    }
    const key = await operatorAuth.assertCurrentOperatorKey(
      req.actor.keyId,
      req.actor.userId,
    );
    await operatorAuth.revokeOperatorApiKey(key.id, { userId: key.userId, revokedVia: "cli_auth_logout" });
    res.json({ revoked: true, keyId: key.id });
  });

  async function assertSpacePermission(
    req: Request,
    spaceId: string,
    permissionKey: any
  ) {
    assertSpaceAccess(req, spaceId);
    if (req.actor.type === "agent") {
      if (!req.actor.agentId) throw forbidden();
      const allowed = await access.hasPermission(
        spaceId,
        "agent",
        req.actor.agentId,
        permissionKey
      );
      if (!allowed) throw forbidden("Permission denied");
      return;
    }
    if (req.actor.type !== "operator") throw unauthorized();
    if (isLocalImplicit(req)) return;
    const allowed = await access.canUser(
      spaceId,
      req.actor.userId,
      permissionKey
    );
    if (!allowed) throw forbidden("Permission denied");
  }

  async function assertCanGenerateOpenClawInvitePrompt(
    req: Request,
    spaceId: string
  ) {
    await assertSpacePermission(req, spaceId, "users:invite");
  }

  async function createSpaceInviteForSpace(input: {
    req: Request;
    spaceId: string;
    allowedJoinTypes: "human" | "agent" | "both";
    humanRole?: "owner" | "admin" | "operator" | "viewer" | null;
    defaultsPayload?: Record<string, unknown> | null;
    agentMessage?: string | null;
  }) {
    const normalizedAgentMessage =
      typeof input.agentMessage === "string"
        ? input.agentMessage.trim() || null
        : null;
    const effectiveHumanRole =
      input.allowedJoinTypes === "agent"
        ? null
        : input.humanRole ?? "operator";
    if (effectiveHumanRole) {
      // An invitation must not delegate the membership powers its creator lacks.
      const roleGrants = grantsForHumanRole(effectiveHumanRole);
      for (const permissionKey of ["joins:approve", "users:manage_permissions"] as const) {
        if (roleGrants.some((grant) => grant.permissionKey === permissionKey)) {
          await assertSpacePermission(input.req, input.spaceId, permissionKey);
        }
      }
    }
    const insertValues = {
      spaceId: input.spaceId,
      inviteType: "space_join" as const,
      allowedJoinTypes: input.allowedJoinTypes,
      defaultsPayload: mergeInviteDefaults(
        input.defaultsPayload ?? null,
        normalizedAgentMessage,
        effectiveHumanRole,
      ),
      expiresAt: spaceInviteExpiresAt(),
      invitedByUserId: input.req.actor.userId ?? null
    };

    let token: string | null = null;
    let created: typeof invites.$inferSelect | null = null;
    for (let attempt = 0; attempt < INVITE_TOKEN_MAX_RETRIES; attempt += 1) {
      const candidateToken = createInviteToken();
      try {
        const row = await db
          .insert(invites)
          .values({
            ...insertValues,
            tokenHash: hashToken(candidateToken)
          })
          .returning()
          .then((rows) => rows[0]);
        token = candidateToken;
        created = row;
        break;
      } catch (error) {
        if (!isInviteTokenHashCollisionError(error)) {
          throw error;
        }
      }
    }
    if (!token || !created) {
      throw conflict("Failed to generate a unique invite token. Please retry.");
    }

    return { token, created, normalizedAgentMessage };
  }

  async function approveHumanJoinRequestFromInvite(input: {
    req: Request;
    invite: typeof invites.$inferSelect;
    joinRequest: typeof joinRequests.$inferSelect;
    spaceId: string;
  }) {
    if (input.joinRequest.requestType !== "human") {
      throw badRequest("Only human join requests can be approved through a human invite");
    }
    if (!input.joinRequest.requestingUserId) {
      throw conflict("Join request missing user identity");
    }

    const membershipRole = resolveHumanInviteRole(
      input.invite.defaultsPayload as Record<string, unknown> | null,
    );
    await access.ensureMembership(
      input.spaceId,
      "user",
      input.joinRequest.requestingUserId,
      membershipRole,
      "active",
    );
    const grants = humanJoinGrantsFromDefaults(
      input.invite.defaultsPayload as Record<string, unknown> | null,
      membershipRole,
    );
    await access.setPrincipalGrants(
      input.spaceId,
      "user",
      input.joinRequest.requestingUserId,
      grants,
      input.invite.invitedByUserId ?? null,
    );

    if (input.joinRequest.status === "approved") {
      return input.joinRequest;
    }

    const approvedAt = new Date();
    const approvedByUserId =
      input.invite.invitedByUserId ?? (isLocalImplicit(input.req) ? "local-operator" : null);
    const approved = await writeJoinRequestChange(db, tx => tx
      .update(joinRequests)
      .set({
        status: "approved",
        approvedByUserId,
        approvedAt,
        updatedAt: approvedAt,
      })
      .where(eq(joinRequests.id, input.joinRequest.id))
      .returning()
      .then((rows) => rows[0] ?? null));

    await logActivity(db, {
      spaceId: input.spaceId,
      actorType: "user",
      actorId: approvedByUserId ?? "operator",
      action: "join.approved",
      entityType: "join_request",
      entityId: input.joinRequest.id,
      details: {
        requestType: "human",
        inviteId: input.invite.id,
        source: "human_invite_accept",
      },
    });

    return approved ?? {
      ...input.joinRequest,
      status: "approved",
      approvedByUserId,
      approvedAt,
      updatedAt: approvedAt,
    };
  }

  async function getInviteSpaceBranding(
    spaceId: string | null,
    inviteToken: string | null = null,
  ): Promise<{
    name: string | null;
    logoAssetId: string | null;
    logoUrl: string | null;
  }> {
    if (!spaceId) {
      return { name: null, logoAssetId: null, logoUrl: null };
    }
    const space = await db
      .select({
        name: spaces.name,
        logoAssetId: spaceLogos.assetId,
      })
      .from(spaces)
      .leftJoin(spaceLogos, eq(spaceLogos.spaceId, spaces.id))
      .where(eq(spaces.id, spaceId))
      .then((rows) => rows[0] ?? null);
    let logoUrl: string | null = null;
    if (inviteToken && space?.logoAssetId) {
      const logoAsset = await getInviteLogoAsset(spaceId);
      if (logoAsset?.spaceId) {
        try {
          const storage = getStorageService();
          const logoObject = await storage.headObject(logoAsset.spaceId, logoAsset.objectKey);
          if (logoObject.exists) {
            logoUrl = `/api/invites/${inviteToken}/logo`;
          }
        } catch (err) {
          logger.warn(
            {
              err,
              spaceId,
              logoAssetId: space.logoAssetId,
            },
            "invite logo storage check failed",
          );
        }
      }
    }

    return {
      name: space?.name ?? null,
      logoAssetId: space?.logoAssetId ?? null,
      logoUrl,
    };
  }

  async function getInviteLogoAsset(spaceId: string | null): Promise<{
    spaceId: string | null;
    objectKey: string;
    contentType: string | null;
    byteSize: number | null;
    originalFilename: string | null;
  } | null> {
    if (!spaceId) return null;
    const logoAsset = await db
      .select({
        spaceId: spaces.id,
        objectKey: assets.objectKey,
        contentType: assets.contentType,
        byteSize: assets.byteSize,
        originalFilename: assets.originalFilename,
      })
      .from(spaces)
      .leftJoin(spaceLogos, eq(spaceLogos.spaceId, spaces.id))
      .leftJoin(assets, eq(assets.id, spaceLogos.assetId))
      .where(eq(spaces.id, spaceId))
      .then((rows) => rows[0] ?? null);

    if (!logoAsset?.objectKey) return null;
    return {
      spaceId: logoAsset.spaceId,
      objectKey: logoAsset.objectKey,
      contentType: logoAsset.contentType,
      byteSize: logoAsset.byteSize,
      originalFilename: logoAsset.originalFilename,
    };
  }

  router.get("/skills/available", (req, res) => {
    assertAuthenticated(req);
    res.json({ skills: listAvailableSkills() });
  });

  router.get("/skills/index", (req, res) => {
    assertAuthenticated(req);
    res.json({
      skills: [
        { name: "outpost", path: "/api/skills/outpost" }
      ]
    });
  });

  router.get("/skills/:skillName", (req, res) => {
    assertAuthenticated(req);
    const skillName = (req.params.skillName as string).trim().toLowerCase();
    const markdown = readSkillMarkdown(skillName);
    if (!markdown) throw notFound("Skill not found");
    res.type("text/markdown").send(markdown);
  });

  router.post(
    "/spaces/:spaceId/invites",
    validate(createSpaceInviteSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      await assertSpacePermission(req, spaceId, "users:invite");
      const { token, created, normalizedAgentMessage } =
        await createSpaceInviteForSpace({
          req,
          spaceId,
          allowedJoinTypes: req.body.allowedJoinTypes,
          humanRole: req.body.humanRole ?? null,
          defaultsPayload: req.body.defaultsPayload ?? null,
          agentMessage: req.body.agentMessage ?? null
        });

      await logActivity(db, {
        spaceId,
        actorType: req.actor.type === "agent" ? "agent" : "user",
        actorId:
          req.actor.type === "agent"
            ? req.actor.agentId ?? "unknown-agent"
            : req.actor.userId ?? "operator",
        action: "invite.created",
        entityType: "invite",
        entityId: created.id,
        details: {
          inviteType: created.inviteType,
          allowedJoinTypes: created.allowedJoinTypes,
          expiresAt: created.expiresAt.toISOString(),
          humanRole: extractInviteHumanRole(created),
          hasAgentMessage: Boolean(normalizedAgentMessage)
        }
      });

      const spaceBranding = await getInviteSpaceBranding(created.spaceId, token);
      const inviteSummary = toInviteSummaryResponse(
        req,
        token,
        created,
        spaceBranding,
        opts.authPublicBaseUrl
      );
      res.status(201).json({
        ...created,
        token,
        invitePath: inviteSummary.invitePath,
        inviteUrl: inviteSummary.inviteUrl,
        spaceName: spaceBranding.name,
        onboardingTextPath: inviteSummary.onboardingTextPath,
        onboardingTextUrl: inviteSummary.onboardingTextUrl,
        inviteMessage: inviteSummary.inviteMessage
      });
    }
  );

  router.post(
    "/spaces/:spaceId/openclaw/invite-prompt",
    validate(createOpenClawInvitePromptSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      await assertCanGenerateOpenClawInvitePrompt(req, spaceId);
      const { token, created, normalizedAgentMessage } =
        await createSpaceInviteForSpace({
          req,
          spaceId,
          allowedJoinTypes: "agent",
          humanRole: null,
          defaultsPayload: null,
          agentMessage: req.body.agentMessage ?? null
        });

      await logActivity(db, {
        spaceId,
        actorType: req.actor.type === "agent" ? "agent" : "user",
        actorId:
          req.actor.type === "agent"
            ? req.actor.agentId ?? "unknown-agent"
            : req.actor.userId ?? "operator",
        action: "invite.openclaw_prompt_created",
        entityType: "invite",
        entityId: created.id,
        details: {
          inviteType: created.inviteType,
          allowedJoinTypes: created.allowedJoinTypes,
          expiresAt: created.expiresAt.toISOString(),
          hasAgentMessage: Boolean(normalizedAgentMessage)
        }
      });

      const spaceBranding = await getInviteSpaceBranding(created.spaceId, token);
      const inviteSummary = toInviteSummaryResponse(
        req,
        token,
        created,
        spaceBranding,
        opts.authPublicBaseUrl
      );
      res.status(201).json({
        ...created,
        token,
        invitePath: inviteSummary.invitePath,
        inviteUrl: inviteSummary.inviteUrl,
        spaceName: spaceBranding.name,
        onboardingTextPath: inviteSummary.onboardingTextPath,
        onboardingTextUrl: inviteSummary.onboardingTextUrl,
        inviteMessage: inviteSummary.inviteMessage
      });
    }
  );

  router.get("/invites/:token", async (req, res) => {
    const token = (req.params.token as string).trim();
    if (!token) throw notFound("Invite not found");
    const invite = await db
      .select()
      .from(invites)
      .where(eq(invites.tokenHash, hashToken(token)))
      .then((rows) => rows[0] ?? null);
    const inviteJoinRequest = await resolveAcceptedInviteJoinRequest(db, req, invite);
    if (
      !invite ||
      invite.revokedAt ||
      inviteExpired(invite) ||
      (invite.acceptedAt && !inviteJoinRequest)
    ) {
      throw notFound("Invite not found");
    }

    const spaceBranding = await getInviteSpaceBranding(invite.spaceId, token);
    const inviterName = invite.invitedByUserId
      ? await loadUsersById(db, [invite.invitedByUserId]).then(
          (m) => m.get(invite.invitedByUserId!)?.name ?? null
        )
      : null;
    res.json({
      ...toInviteSummaryResponse(req, token, invite, spaceBranding, opts.authPublicBaseUrl),
      invitedByUserName: inviterName,
      joinRequestStatus: inviteJoinRequest?.status ?? null,
      joinRequestType: inviteJoinRequest?.requestType ?? null,
    });
  });

  router.get("/invites/:token/logo", async (req, res, next) => {
    const token = (req.params.token as string).trim();
    if (!token) throw notFound("Invite not found");
    const invite = await db
      .select()
      .from(invites)
      .where(eq(invites.tokenHash, hashToken(token)))
      .then((rows) => rows[0] ?? null);
    const inviteJoinRequest = await resolveAcceptedInviteJoinRequest(db, req, invite);
    if (
      !invite ||
      invite.revokedAt ||
      inviteExpired(invite) ||
      (invite.acceptedAt && !inviteJoinRequest)
    ) {
      throw notFound("Invite not found");
    }

    const logoAsset = await getInviteLogoAsset(invite.spaceId);
    if (!logoAsset || !logoAsset.spaceId) {
      throw notFound("Invite logo not found");
    }
    const spaceId = logoAsset.spaceId;

    const storage = getStorageService();
    const logoHead = await storage.headObject(spaceId, logoAsset.objectKey);
    if (!logoHead.exists) {
      throw notFound("Invite logo not found");
    }
    const object = await storage.getObject(spaceId, logoAsset.objectKey);
    const responseContentType =
      logoAsset.contentType ||
      logoHead.contentType ||
      object.contentType ||
      "application/octet-stream";
    res.setHeader("Content-Type", responseContentType);
    res.setHeader(
      "Content-Length",
      String(logoAsset.byteSize || logoHead.contentLength || object.contentLength || 0),
    );
    res.setHeader("Cache-Control", "private, max-age=60");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (responseContentType === "image/svg+xml") {
      res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
    }
    const filename = logoAsset.originalFilename ?? "space-logo";
    res.setHeader("Content-Disposition", `inline; filename=\"${filename.replaceAll("\"", "")}\"`);

    object.stream.on("error", (err) => {
      next(err);
    });
    object.stream.pipe(res);
  });

  router.get("/invites/:token/onboarding", async (req, res) => {
    const token = (req.params.token as string).trim();
    if (!token) throw notFound("Invite not found");
    const invite = await db
      .select()
      .from(invites)
      .where(eq(invites.tokenHash, hashToken(token)))
      .then((rows) => rows[0] ?? null);
    if (!invite || invite.revokedAt || inviteExpired(invite)) {
      throw notFound("Invite not found");
    }

    const spaceBranding = await getInviteSpaceBranding(invite.spaceId);
    res.json(buildInviteOnboardingManifest(req, token, invite, {
      ...opts,
      spaceName: spaceBranding.name
    }));
  });

  router.get("/invites/:token/onboarding.txt", async (req, res) => {
    const token = (req.params.token as string).trim();
    if (!token) throw notFound("Invite not found");
    const invite = await db
      .select()
      .from(invites)
      .where(eq(invites.tokenHash, hashToken(token)))
      .then((rows) => rows[0] ?? null);
    if (!invite || invite.revokedAt || inviteExpired(invite)) {
      throw notFound("Invite not found");
    }

    const spaceBranding = await getInviteSpaceBranding(invite.spaceId);
    res
      .type("text/plain; charset=utf-8")
      .send(
        buildInviteOnboardingTextDocument(req, token, invite, {
          ...opts,
          spaceName: spaceBranding.name
        })
      );
  });

  router.get("/invites/:token/skills/index", async (req, res) => {
    const token = (req.params.token as string).trim();
    if (!token) throw notFound("Invite not found");
    const invite = await db
      .select()
      .from(invites)
      .where(eq(invites.tokenHash, hashToken(token)))
      .then((rows) => rows[0] ?? null);
    if (!invite || invite.revokedAt || inviteExpired(invite)) {
      throw notFound("Invite not found");
    }

    res.json({
      skills: [
        {
          name: "outpost",
          path: `/api/invites/${token}/skills/outpost`,
        },
      ],
    });
  });

  router.get("/invites/:token/skills/:skillName", async (req, res) => {
    const token = (req.params.token as string).trim();
    if (!token) throw notFound("Invite not found");
    const invite = await db
      .select()
      .from(invites)
      .where(eq(invites.tokenHash, hashToken(token)))
      .then((rows) => rows[0] ?? null);
    if (!invite || invite.revokedAt || inviteExpired(invite)) {
      throw notFound("Invite not found");
    }

    const skillName = (req.params.skillName as string).trim().toLowerCase();
    if (skillName !== "outpost") throw notFound("Skill not found");
    const markdown = readSkillMarkdown(skillName);
    if (!markdown) throw notFound("Skill not found");
    res.type("text/markdown").send(markdown);
  });

  router.get("/invites/:token/test-resolution", async (req, res) => {
    const token = (req.params.token as string).trim();
    if (!token) throw notFound("Invite not found");
    const invite = await db
      .select()
      .from(invites)
      .where(eq(invites.tokenHash, hashToken(token)))
      .then((rows) => rows[0] ?? null);
    if (!invite || invite.revokedAt || inviteExpired(invite)) {
      throw notFound("Invite not found");
    }

    const rawUrl =
      typeof req.query.url === "string" ? req.query.url.trim() : "";
    if (!rawUrl) throw badRequest("url query parameter is required");
    let target: URL;
    try {
      target = new URL(rawUrl);
    } catch {
      throw badRequest("url must be an absolute http(s) URL");
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw badRequest("url must use http or https");
    }

    const parsedTimeoutMs =
      typeof req.query.timeoutMs === "string"
        ? Number(req.query.timeoutMs)
        : NaN;
    const timeoutMs = Number.isFinite(parsedTimeoutMs)
      ? Math.max(1000, Math.min(15000, Math.floor(parsedTimeoutMs)))
      : 5000;
    const resolvedTarget = await resolveInviteResolutionTarget(target, routeInviteResolutionNetwork);
    const probe = await probeInviteResolutionTarget(resolvedTarget, timeoutMs, routeInviteResolutionNetwork);
    res.json({
      inviteId: invite.id,
      testResolutionPath: `/api/invites/${token}/test-resolution`,
      requestedUrl: target.toString(),
      timeoutMs,
      ...probe
    });
  });

  router.post(
    "/invites/:token/accept",
    validate(acceptInviteSchema),
    async (req, res) => {
      const token = (req.params.token as string).trim();
      if (!token) throw notFound("Invite not found");

      const invite = await db
        .select()
        .from(invites)
        .where(eq(invites.tokenHash, hashToken(token)))
        .then((rows) => rows[0] ?? null);
      if (!invite || invite.revokedAt || inviteExpired(invite)) {
        throw notFound("Invite not found");
      }
      const inviteAlreadyAccepted = Boolean(invite.acceptedAt);
      const existingJoinRequestForInvite = inviteAlreadyAccepted
        ? await db
            .select()
            .from(joinRequests)
            .where(eq(joinRequests.inviteId, invite.id))
            .then((rows) => rows[0] ?? null)
        : null;

      if (invite.inviteType === "bootstrap_lead") {
        if (inviteAlreadyAccepted) throw notFound("Invite not found");
        if (req.body.requestType !== "human") {
          throw badRequest("Bootstrap invite requires human request type");
        }
        if (
          req.actor.type !== "operator" ||
          (!req.actor.userId && !isLocalImplicit(req))
        ) {
          throw unauthorized(
            "Authenticated user required for bootstrap acceptance"
          );
        }
        const userId = req.actor.userId ?? "local-operator";
        const claimed = await claimFirstInstanceAdmin(db, {
          userId,
          onClaim: async (tx) => {
            const updatedInvite = await tx
              .update(invites)
              .set({ acceptedAt: new Date(), updatedAt: new Date() })
              .where(
                and(
                  eq(invites.id, invite.id),
                  isNull(invites.acceptedAt),
                  isNull(invites.revokedAt)
                )
              )
              .returning()
              .then((rows) => rows[0] ?? null);
            if (!updatedInvite) {
              throw conflict("Bootstrap invite is no longer available");
            }
            return updatedInvite;
          },
        });
        if (claimed.status === "already_claimed") {
          throw conflict("Someone else has already claimed this instance");
        }
        const updatedInvite = claimed.value ?? invite;
        res.status(202).json({
          inviteId: updatedInvite.id,
          inviteType: updatedInvite.inviteType,
          bootstrapAccepted: true,
          userId
        });
        return;
      }

      const requestType = req.body.requestType as "human" | "agent";
      const spaceId = invite.spaceId;
      if (!spaceId) throw conflict("Invite is missing space scope");
      if (
        invite.allowedJoinTypes !== "both" &&
        invite.allowedJoinTypes !== requestType
      ) {
        throw badRequest(`Invite does not allow ${requestType} joins`);
      }

      if (requestType === "human" && req.actor.type !== "operator") {
        throw unauthorized(
          "Human invite acceptance requires authenticated user"
        );
      }
      if (
        requestType === "human" &&
        !req.actor.userId &&
        !isLocalImplicit(req)
      ) {
        throw unauthorized("Authenticated user is required");
      }
      if (
        requestType === "human" &&
        actorHasActiveUserMembership(req, spaceId)
      ) {
        throw conflict("You already belong to this space");
      }
      if (requestType === "agent" && !req.body.agentName) {
        if (
          !inviteAlreadyAccepted ||
          !existingJoinRequestForInvite?.agentName
        ) {
          throw badRequest("agentName is required for agent join requests");
        }
      }

      const actorEmail =
        requestType === "human" ? await resolveActorEmail(db, req) : null;
      const actorRequestingUserId =
        requestType === "human"
          ? req.actor.userId ?? "local-operator"
          : null;
      const canReplayHumanInviteAccept =
        inviteAlreadyAccepted &&
        requestType === "human" &&
        existingJoinRequestForInvite?.requestType === "human" &&
        Boolean(
          findReusableHumanJoinRequest([existingJoinRequestForInvite], {
            requestingUserId: actorRequestingUserId,
            requestEmailSnapshot: actorEmail,
          })
        );
      const adapterType = req.body.adapterType ?? null;
      if (requestType === "agent") {
        assertLegacyAgentInviteAdapterType(
          adapterType ?? existingJoinRequestForInvite?.adapterType ?? null,
        );
      }
      if (
        inviteAlreadyAccepted &&
        !canReplayHumanInviteAccept &&
        !canReplayOpenClawGatewayInviteAccept({
          requestType,
          adapterType,
          existingJoinRequest: existingJoinRequestForInvite
        })
      ) {
        throw notFound("Invite not found");
      }
      const replayJoinRequestId = inviteAlreadyAccepted
        ? existingJoinRequestForInvite?.id ?? null
        : null;
      if (inviteAlreadyAccepted && !replayJoinRequestId) {
        throw conflict("Join request not found");
      }

      const replayMergedDefaults = inviteAlreadyAccepted
        ? mergeJoinDefaultsPayloadForReplay(
            existingJoinRequestForInvite?.agentDefaultsPayload ?? null,
            req.body.agentDefaultsPayload ?? null
          )
        : req.body.agentDefaultsPayload ?? null;

      const gatewayDefaultsPayload =
        requestType === "agent"
          ? buildJoinDefaultsPayloadForAccept({
              adapterType,
              defaultsPayload: replayMergedDefaults,
              outpostApiUrl: req.body.outpostApiUrl ?? null,
              inboundOpenClawAuthHeader: req.header("x-openclaw-auth") ?? null,
              inboundOpenClawTokenHeader: req.header("x-openclaw-token") ?? null
            })
          : null;

      const joinDefaults =
        requestType === "agent"
          ? normalizeAgentDefaultsForJoin({
              adapterType,
              defaultsPayload: gatewayDefaultsPayload,
              deploymentMode: opts.deploymentMode,
              deploymentExposure: opts.deploymentExposure,
              bindHost: opts.bindHost,
              allowedHostnames: opts.allowedHostnames
            })
          : {
              normalized: null as Record<string, unknown> | null,
              diagnostics: [] as JoinDiagnostic[],
              fatalErrors: [] as string[]
            };

      if (requestType === "agent" && joinDefaults.fatalErrors.length > 0) {
        throw badRequest(joinDefaults.fatalErrors.join("; "));
      }

      const persistedJoinDefaultsPayload =
        requestType === "agent"
          ? await prepareAgentDefaultsPayloadForJoinPersistence({
              db,
              spaceId,
              adapterType,
              normalized: joinDefaults.normalized,
              actor: {
                userId: req.actor.userId ?? null,
                agentId: req.actor.agentId ?? null
              }
            })
          : null;

      if (requestType === "agent" && adapterType === "openclaw_gateway") {
        logger.info(
          {
            inviteId: invite.id,
            joinRequestDiagnostics: joinDefaults.diagnostics.map((diag) => ({
              code: diag.code,
              level: diag.level
            })),
            normalizedAgentDefaults: summarizeOpenClawGatewayDefaultsForLog(
              joinDefaults.normalized
            )
          },
          "invite accept normalized OpenClaw gateway defaults"
        );
      }

      const claimSecret =
        requestType === "agent" && !inviteAlreadyAccepted
          ? createClaimSecret()
          : null;
      const claimSecretHash = claimSecret ? hashToken(claimSecret) : null;
      const claimSecretExpiresAt = claimSecret
        ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        : null;

      const existingHumanJoinRequest =
        requestType === "human"
          ? findReusableHumanJoinRequest(
              await db
                .select()
                .from(joinRequests)
                .where(
                  and(
                    eq(joinRequests.spaceId, spaceId),
                    eq(joinRequests.requestType, "human")
                  )
                )
                .orderBy(desc(joinRequests.createdAt)),
              {
                requestingUserId: actorRequestingUserId,
                requestEmailSnapshot: actorEmail
              }
            )
          : null;
      let created = !inviteAlreadyAccepted
        ? existingHumanJoinRequest
          ? await db.transaction(async (tx) => {
              await tx
                .update(invites)
                .set({ acceptedAt: new Date(), updatedAt: new Date() })
                .where(
                  and(
                    eq(invites.id, invite.id),
                    isNull(invites.acceptedAt),
                    isNull(invites.revokedAt)
                  )
                );
              return existingHumanJoinRequest;
            })
          : await db.transaction(async (tx) => {
              await tx
                .update(invites)
                .set({ acceptedAt: new Date(), updatedAt: new Date() })
                .where(
                  and(
                    eq(invites.id, invite.id),
                    isNull(invites.acceptedAt),
                    isNull(invites.revokedAt)
                  )
                );

              await notifyRetentionWork(tx, "join_request");
              const row = await tx
                .insert(joinRequests)
                .values({
                  inviteId: invite.id,
                  spaceId,
                  requestType,
                  status: "pending_approval",
                  requestIp: requestIp(req),
                  requestingUserId:
                    requestType === "human"
                      ? req.actor.userId ?? "local-operator"
                      : null,
                  requestEmailSnapshot:
                    requestType === "human" ? actorEmail : null,
                  agentName:
                    requestType === "agent" ? req.body.agentName : null,
                  adapterType: requestType === "agent" ? adapterType : null,
                  capabilities:
                    requestType === "agent"
                      ? req.body.capabilities ?? null
                      : null,
                  agentDefaultsPayload:
                    requestType === "agent" ? persistedJoinDefaultsPayload : null,
                  claimSecretHash,
                  claimSecretExpiresAt
                })
                .returning()
                .then((rows) => rows[0]);
              return row;
            })
        : await writeJoinRequestChange(db, tx => tx
            .update(joinRequests)
            .set({
              requestIp: requestIp(req),
              agentName:
                requestType === "agent"
                  ? req.body.agentName ??
                    existingJoinRequestForInvite?.agentName ??
                    null
                  : null,
              capabilities:
                requestType === "agent"
                  ? req.body.capabilities ??
                    existingJoinRequestForInvite?.capabilities ??
                    null
                  : null,
              adapterType: requestType === "agent" ? adapterType : null,
              agentDefaultsPayload:
                requestType === "agent" ? persistedJoinDefaultsPayload : null,
              updatedAt: new Date()
            })
            .where(eq(joinRequests.id, replayJoinRequestId as string))
            .returning()
            .then((rows) => rows[0]));

      if (!created) {
        throw conflict("Join request not found");
      }

      if (
        inviteAlreadyAccepted &&
        requestType === "agent" &&
        adapterType === "openclaw_gateway" &&
        created.status === "approved" &&
        created.createdAgentId
      ) {
        const existingAgent = await agents.getById(created.createdAgentId);
        if (!existingAgent) {
          throw conflict("Approved join request agent not found");
        }
        const existingAdapterConfig = isPlainObject(existingAgent.adapterConfig)
          ? (existingAgent.adapterConfig as Record<string, unknown>)
          : {};
        const nextAdapterConfig = {
          ...existingAdapterConfig,
          ...(joinDefaults.normalized ?? {})
        };
        const updatedAgent = await agents.update(created.createdAgentId, {
          adapterType,
          adapterConfig: nextAdapterConfig
        });
        if (!updatedAgent) {
          throw conflict("Approved join request agent not found");
        }
        await logActivity(db, {
          spaceId,
          actorType: req.actor.type === "agent" ? "agent" : "user",
          actorId:
            req.actor.type === "agent"
              ? req.actor.agentId ?? "invite-agent"
              : req.actor.userId ?? "operator",
          action: "agent.updated_from_join_replay",
          entityType: "agent",
          entityId: updatedAgent.id,
          details: { inviteId: invite.id, joinRequestId: created.id }
        });
      }

      if (requestType === "agent" && adapterType === "openclaw_gateway") {
        const expectedDefaults = summarizeOpenClawGatewayDefaultsForLog(
          joinDefaults.normalized
        );
        const persistedDefaults = summarizeOpenClawGatewayDefaultsForLog(
          created.agentDefaultsPayload
        );
        const missingPersistedFields: string[] = [];

        if (expectedDefaults.url && !persistedDefaults.url)
          missingPersistedFields.push("url");
        if (
          expectedDefaults.outpostApiUrl &&
          !persistedDefaults.outpostApiUrl
        ) {
          missingPersistedFields.push("outpostApiUrl");
        }
        if (expectedDefaults.gatewayToken && !persistedDefaults.gatewayToken) {
          missingPersistedFields.push("headers.x-openclaw-token");
        }
        if (
          expectedDefaults.devicePrivateKeyPem &&
          !persistedDefaults.devicePrivateKeyPem
        ) {
          missingPersistedFields.push("devicePrivateKeyPem");
        }
        if (
          expectedDefaults.headerKeys.length > 0 &&
          persistedDefaults.headerKeys.length === 0
        ) {
          missingPersistedFields.push("headers");
        }

        logger.info(
          {
            inviteId: invite.id,
            joinRequestId: created.id,
            joinRequestStatus: created.status,
            expectedDefaults,
            persistedDefaults,
            diagnostics: joinDefaults.diagnostics.map((diag) => ({
              code: diag.code,
              level: diag.level,
              message: diag.message,
              hint: diag.hint ?? null
            }))
          },
          "invite accept persisted OpenClaw gateway join request"
        );

        if (missingPersistedFields.length > 0) {
          logger.warn(
            {
              inviteId: invite.id,
              joinRequestId: created.id,
              missingPersistedFields
            },
            "invite accept detected missing persisted OpenClaw gateway defaults"
          );
        }
      }

      await logActivity(db, {
        spaceId,
        actorType: req.actor.type === "agent" ? "agent" : "user",
        actorId:
          req.actor.type === "agent"
            ? req.actor.agentId ?? "invite-agent"
            : req.actor.userId ??
              (requestType === "agent" ? "invite-anon" : "operator"),
        action: inviteAlreadyAccepted
          ? "join.request_replayed"
          : "join.requested",
        entityType: "join_request",
        entityId: created.id,
        details: {
          requestType,
          requestIp: requestIp(req),
          inviteReplay: inviteAlreadyAccepted,
          reusedExistingJoinRequest:
            Boolean(existingHumanJoinRequest) && !inviteAlreadyAccepted
        }
      });

      if (requestType === "human") {
        created = await approveHumanJoinRequestFromInvite({
          req,
          invite,
          joinRequest: created,
          spaceId,
        });
      }

      const response = toJoinRequestResponse(created);
      if (claimSecret) {
        const spaceBranding = await getInviteSpaceBranding(invite.spaceId);
        const onboardingManifest = buildInviteOnboardingManifest(
          req,
          token,
          invite,
          {
            ...opts,
            spaceName: spaceBranding.name
          }
        );
        res.status(202).json({
          ...response,
          claimSecret,
          claimApiKeyPath: `/api/join-requests/${created.id}/claim-api-key`,
          onboarding: onboardingManifest.onboarding,
          diagnostics: joinDefaults.diagnostics
        });
        return;
      }
      res.status(202).json({
        ...response,
        ...(joinDefaults.diagnostics.length > 0
          ? { diagnostics: joinDefaults.diagnostics }
          : {})
      });
    }
  );

  router.post("/invites/:inviteId/revoke", async (req, res) => {
    const id = req.params.inviteId as string;
    const invite = await db
      .select()
      .from(invites)
      .where(eq(invites.id, id))
      .then((rows) => rows[0] ?? null);
    if (!invite) throw notFound("Invite not found");
    if (invite.inviteType === "bootstrap_lead") {
      await assertInstanceAdmin(req);
    } else {
      if (!invite.spaceId) throw conflict("Invite is missing space scope");
      await assertSpacePermission(req, invite.spaceId, "users:invite");
    }
    if (invite.acceptedAt) throw conflict("Invite already consumed");
    if (invite.revokedAt) return res.json(invite);

    const revoked = await db
      .update(invites)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(invites.id, id))
      .returning()
      .then((rows) => rows[0]);

    if (invite.spaceId) {
      await logActivity(db, {
        spaceId: invite.spaceId,
        actorType: req.actor.type === "agent" ? "agent" : "user",
        actorId:
          req.actor.type === "agent"
            ? req.actor.agentId ?? "unknown-agent"
            : req.actor.userId ?? "operator",
        action: "invite.revoked",
        entityType: "invite",
        entityId: id
      });
    }

    res.json(revoked);
  });

  router.get("/spaces/:spaceId/invites", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    await assertSpacePermission(req, spaceId, "users:invite");
    const query = listSpaceInvitesQuerySchema.parse(req.query);
    const invitesForSpace = await loadSpaceInviteRecords(db, spaceId, query);
    res.json(invitesForSpace);
  });

  router.get("/spaces/:spaceId/join-requests", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    await assertSpacePermission(req, spaceId, "joins:approve");
    const query = listJoinRequestsQuerySchema.parse(req.query);
    const all = await loadJoinRequestRecords(db, spaceId);
    const filtered = all.filter((row) => {
      if (query.status && row.status !== query.status) return false;
      if (query.requestType && row.requestType !== query.requestType)
        return false;
      return true;
    });
    res.json(filtered);
  });

  router.post(
    "/spaces/:spaceId/join-requests/:requestId/approve",
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      const requestId = req.params.requestId as string;
      await assertSpacePermission(req, spaceId, "joins:approve");

      const existing = await db
        .select()
        .from(joinRequests)
        .where(
          and(
            eq(joinRequests.spaceId, spaceId),
            eq(joinRequests.id, requestId)
          )
        )
        .then((rows) => rows[0] ?? null);
      if (!existing) throw notFound("Join request not found");
      if (existing.status !== "pending_approval")
        throw conflict("Join request is not pending");

      const invite = await db
        .select()
        .from(invites)
        .where(eq(invites.id, existing.inviteId))
        .then((rows) => rows[0] ?? null);
      if (!invite) throw notFound("Invite not found");

      let createdAgentId: string | null = existing.createdAgentId ?? null;
      if (existing.requestType === "human") {
        if (!existing.requestingUserId)
          throw conflict("Join request missing user identity");
        const membershipRole = resolveHumanInviteRole(
          invite.defaultsPayload as Record<string, unknown> | null,
        );
        await access.ensureMembership(
          spaceId,
          "user",
          existing.requestingUserId,
          membershipRole,
          "active"
        );
        const grants = humanJoinGrantsFromDefaults(
          invite.defaultsPayload as Record<string, unknown> | null,
          membershipRole
        );
        await access.setPrincipalGrants(
          spaceId,
          "user",
          existing.requestingUserId,
          grants,
          req.actor.userId ?? null
        );
      } else {
        assertLegacyAgentInviteAdapterType(existing.adapterType);
        const existingAgents = await agents.list(spaceId);
        const space = await db.query.spaces.findFirst({
          where: eq(spaces.id, spaceId),
        });
        const leadAgentId = resolveJoinRequestLeadAgentId(
          existingAgents,
          space?.defaultAgentId,
        );
        if (!leadAgentId) {
          throw conflict(
            "Join request cannot be approved because this Space has no active agents"
          );
        }

        const agentName = deduplicateAgentName(
          existing.agentName ?? "New Agent",
          existingAgents.map((a) => ({
            id: a.id,
            name: a.name,
            status: a.status
          }))
        );

        const created = await agentsLifecycle.requestCreation(spaceId, {
          name: agentName,
          role: "general",
          title: null,
          status: "idle",
          leadAgentId,
          capabilities: existing.capabilities ?? null,
          adapterType: existing.adapterType ?? "process",
          adapterConfig:
            existing.agentDefaultsPayload &&
            typeof existing.agentDefaultsPayload === "object"
              ? (existing.agentDefaultsPayload as Record<string, unknown>)
              : {},
          runtimeConfig: {},
          budgetMonthlyCents: 0,
          spentMonthlyCents: 0,
          permissions: {},
          lastHeartbeatAt: null,
          metadata: null
        });
        createdAgentId = created.id;
        await access.ensureMembership(
          spaceId,
          "agent",
          created.id,
          "member",
          "active"
        );
        const grants = agentJoinGrantsFromDefaults(
          invite.defaultsPayload as Record<string, unknown> | null,
          created.id,
        );
        await access.setPrincipalGrants(
          spaceId,
          "agent",
          created.id,
          grants,
          req.actor.userId ?? null
        );
      }

      const approved = await writeJoinRequestChange(db, tx => tx
        .update(joinRequests)
        .set({
          status: "approved",
          approvedByUserId:
            req.actor.userId ?? (isLocalImplicit(req) ? "local-operator" : null),
          approvedAt: new Date(),
          createdAgentId,
          updatedAt: new Date()
        })
        .where(eq(joinRequests.id, requestId))
        .returning()
        .then((rows) => rows[0]));

      await logActivity(db, {
        spaceId,
        actorType: "user",
        actorId: req.actor.userId ?? "operator",
        action: "join.approved",
        entityType: "join_request",
        entityId: requestId,
        details: { requestType: existing.requestType, createdAgentId }
      });

      if (createdAgentId) {
        void notifyCreateApproved(db, {
          spaceId,
          agentId: createdAgentId,
          source: "join_request",
          sourceId: requestId,
          approvedAt: new Date()
        }).catch(() => {});
      }

      res.json(toJoinRequestResponse(approved));
    }
  );

  router.post(
    "/spaces/:spaceId/join-requests/:requestId/reject",
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      const requestId = req.params.requestId as string;
      await assertSpacePermission(req, spaceId, "joins:approve");

      const existing = await db
        .select()
        .from(joinRequests)
        .where(
          and(
            eq(joinRequests.spaceId, spaceId),
            eq(joinRequests.id, requestId)
          )
        )
        .then((rows) => rows[0] ?? null);
      if (!existing) throw notFound("Join request not found");
      if (existing.status !== "pending_approval")
        throw conflict("Join request is not pending");

      const rejected = await writeJoinRequestChange(db, tx => tx
        .update(joinRequests)
        .set({
          status: "rejected",
          rejectedByUserId:
            req.actor.userId ?? (isLocalImplicit(req) ? "local-operator" : null),
          rejectedAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(joinRequests.id, requestId))
        .returning()
        .then((rows) => rows[0]));

      await logActivity(db, {
        spaceId,
        actorType: "user",
        actorId: req.actor.userId ?? "operator",
        action: "join.rejected",
        entityType: "join_request",
        entityId: requestId,
        details: { requestType: existing.requestType }
      });

      res.json(toJoinRequestResponse(rejected));
    }
  );

  router.post(
    "/join-requests/:requestId/claim-api-key",
    validate(claimJoinRequestApiKeySchema),
    async (req, res) => {
      const requestId = req.params.requestId as string;
      const presentedClaimSecretHash = hashToken(req.body.claimSecret);
      const joinRequest = await db
        .select()
        .from(joinRequests)
        .where(eq(joinRequests.id, requestId))
        .then((rows) => rows[0] ?? null);
      if (!joinRequest) throw notFound("Join request not found");
      if (joinRequest.requestType !== "agent")
        throw badRequest("Only agent join requests can claim API keys");
      if (joinRequest.status !== "approved")
        throw conflict("Join request must be approved before key claim");
      if (!joinRequest.createdAgentId)
        throw conflict("Join request has no created agent");
      if (!joinRequest.claimSecretHash)
        throw conflict("Join request is missing claim secret metadata");
      if (
        !tokenHashesMatch(joinRequest.claimSecretHash, presentedClaimSecretHash)
      ) {
        throw forbidden("Invalid claim secret");
      }
      if (
        joinRequest.claimSecretExpiresAt &&
        joinRequest.claimSecretExpiresAt.getTime() <= Date.now()
      ) {
        throw conflict("Claim secret expired");
      }
      if (joinRequest.claimSecretConsumedAt)
        throw conflict("Claim secret already used");

      const existingKey = await db
        .select({ id: agentApiKeys.id })
        .from(agentApiKeys)
        .where(eq(agentApiKeys.agentId, joinRequest.createdAgentId))
        .then((rows) => rows[0] ?? null);
      if (existingKey) throw conflict("API key already claimed");

      const consumed = await db
        .update(joinRequests)
        .set({ claimSecretConsumedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(joinRequests.id, requestId),
            isNull(joinRequests.claimSecretConsumedAt)
          )
        )
        .returning({ id: joinRequests.id })
        .then((rows) => rows[0] ?? null);
      if (!consumed) throw conflict("Claim secret already used");

      const created = await agents.createApiKey(
        joinRequest.createdAgentId,
        "initial-join-key",
        { kind: "standard" },
        { responsibleUserId: joinRequest.approvedByUserId ?? joinRequest.requestingUserId ?? null },
      );

      await logActivity(db, {
        spaceId: joinRequest.spaceId,
        actorType: "system",
        actorId: "join-claim",
        action: "agent_api_key.claimed",
        entityType: "agent_api_key",
        entityId: created.id,
        details: {
          agentId: joinRequest.createdAgentId,
          joinRequestId: requestId,
          responsibleUserId: created.responsibleUserId,
        },
      });

      res.status(201).json({
        keyId: created.id,
        token: created.token,
        agentId: joinRequest.createdAgentId,
        createdAt: created.createdAt
      });
    }
  );

  router.get("/spaces/:spaceId/members", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    await assertSpacePermission(req, spaceId, "users:manage_permissions");
    const [members, currentAccess] = await Promise.all([
      loadSpaceMemberRecords(db, spaceId),
      loadSpaceAccessSummary(req, access, spaceId),
    ]);
    res.json({
      members: await addSpaceMemberRemovalAccess(req, db, access, spaceId, members),
      access: currentAccess,
    });
  });

  router.get("/spaces/:spaceId/user-directory", async (req, res) => {
    const spaceId = req.params.spaceId as string;
    assertSpaceAccess(req, spaceId);
    const users = await loadSpaceUserDirectory(db, spaceId);
    res.json({ users });
  });

  router.patch(
    "/spaces/:spaceId/members/:memberId",
    validate(updateSpaceMemberSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      const memberId = req.params.memberId as string;
      await assertSpacePermission(req, spaceId, "users:manage_permissions");
      const memberToUpdate = await access.getMemberById(spaceId, memberId);
      if (!memberToUpdate) throw notFound("Member not found");
      await assertCanManageSpaceMember(req, access, spaceId, memberToUpdate);

      const updated = await access.updateMember(spaceId, memberId, req.body);
      if (!updated) throw notFound("Member not found");

      await logActivity(db, {
        spaceId,
        actorType: "user",
        actorId: req.actor.userId ?? "operator",
        action: "space_member.updated",
        entityType: "space_membership",
        entityId: memberId,
        details: {
          membershipRole: updated.membershipRole,
          status: updated.status,
        },
      });

      const member = (await loadSpaceMemberRecords(db, spaceId)).find(
        (entry) => entry.id === memberId,
      );
      if (!member) throw notFound("Member not found");
      res.json(member);
    }
  );

  router.patch(
    "/spaces/:spaceId/members/:memberId/role-and-grants",
    validate(updateSpaceMemberWithPermissionsSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      const memberId = req.params.memberId as string;
      await assertSpacePermission(req, spaceId, "users:manage_permissions");
      const memberToUpdate = await access.getMemberById(spaceId, memberId);
      if (!memberToUpdate) throw notFound("Member not found");
      await assertCanManageSpaceMember(req, access, spaceId, memberToUpdate);

      const updated = await access.updateMemberAndPermissions(
        spaceId,
        memberId,
        {
          membershipRole: req.body.membershipRole,
          status: req.body.status,
          grants: req.body.grants ?? [],
        },
        req.actor.userId ?? null,
      );
      if (!updated) throw notFound("Member not found");

      await logActivity(db, {
        spaceId,
        actorType: "user",
        actorId: req.actor.userId ?? "operator",
        action: "space_member.access_updated",
        entityType: "space_membership",
        entityId: memberId,
        details: {
          membershipRole: updated.membershipRole,
          status: updated.status,
          grantCount: req.body.grants?.length ?? 0,
        },
      });

      const member = (await loadSpaceMemberRecords(db, spaceId)).find(
        (entry) => entry.id === memberId,
      );
      if (!member) throw notFound("Member not found");
      res.json(member);
    }
  );

  router.post(
    "/spaces/:spaceId/members/:memberId/archive",
    validate(archiveSpaceMemberSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      const memberId = req.params.memberId as string;
      await assertSpacePermission(req, spaceId, "users:manage_permissions");
      const memberToArchive = await access.getMemberById(spaceId, memberId);
      if (!memberToArchive) throw notFound("Member not found");
      await assertCanManageSpaceMember(req, access, spaceId, memberToArchive, "archive");

      const result = await access.archiveMember(spaceId, memberId, {
        reassignment: req.body.reassignment ?? null,
      });
      if (!result) throw notFound("Member not found");

      await logActivity(db, {
        spaceId,
        actorType: "user",
        actorId: req.actor.userId ?? "operator",
        action: "space_member.archived",
        entityType: "space_membership",
        entityId: memberId,
        details: {
          principalId: result.member.principalId,
          reassignedIssueCount: result.reassignedIssueCount,
          reassignment: req.body.reassignment ?? null,
        },
      });

      const member = (await loadSpaceMemberRecords(db, spaceId, { includeArchived: true })).find(
        (entry) => entry.id === memberId,
      );
      if (!member) throw notFound("Member not found");
      res.json({
        member,
        reassignedIssueCount: result.reassignedIssueCount,
      });
    }
  );

  router.patch(
    "/spaces/:spaceId/members/:memberId/permissions",
    validate(updateMemberPermissionsSchema),
    async (req, res) => {
      const spaceId = req.params.spaceId as string;
      const memberId = req.params.memberId as string;
      await assertSpacePermission(req, spaceId, "users:manage_permissions");
      const memberToUpdate = await access.getMemberById(spaceId, memberId);
      if (!memberToUpdate) throw notFound("Member not found");
      await assertCanManageSpaceMember(req, access, spaceId, memberToUpdate);
      const updated = await access.setMemberPermissions(
        spaceId,
        memberId,
        req.body.grants ?? [],
        req.actor.userId ?? null
      );
      if (!updated) throw notFound("Member not found");
      await logActivity(db, {
        spaceId,
        actorType: "user",
        actorId: req.actor.userId ?? "operator",
        action: "space_member.permissions_updated",
        entityType: "space_membership",
        entityId: memberId,
        details: {
          grantCount: req.body.grants?.length ?? 0,
        },
      });
      const member = (await loadSpaceMemberRecords(db, spaceId)).find(
        (entry) => entry.id === memberId,
      );
      if (!member) throw notFound("Member not found");
      res.json(member);
    }
  );

  router.post(
    "/admin/users/:userId/promote-instance-admin",
    async (req, res) => {
      await assertInstanceAdmin(req);
      assertAccessAdminVisible();
      const userId = req.params.userId as string;
      const result = await access.promoteInstanceAdmin(userId);
      res.status(201).json(result);
    }
  );

  router.get("/admin/users", async (req, res) => {
    await assertInstanceAdmin(req);
    assertAccessAdminVisible();
    const query = searchAdminUsersQuerySchema.parse(req.query);
    const needle = query.query.trim().toLowerCase();
    const users = await db
      .select({
        id: authUsers.id,
        email: authUsers.email,
        name: authUsers.name,
        image: authUsers.image,
      })
      .from(authUsers)
      .orderBy(desc(authUsers.updatedAt));
    const filteredUsers = needle
      ? users.filter((user) =>
          [user.name, user.email]
            .filter((value): value is string => Boolean(value))
            .some((value) => value.toLowerCase().includes(needle)),
        )
      : users;
    const userIds = filteredUsers.slice(0, 50).map((user) => user.id);
    const memberships = userIds.length
      ? await db
          .select({
            principalId: spaceMemberships.principalId,
          })
          .from(spaceMemberships)
          .where(
            and(
              eq(spaceMemberships.principalType, "user"),
              eq(spaceMemberships.status, "active"),
              inArray(spaceMemberships.principalId, userIds),
            ),
          )
      : [];
    const membershipCountByUserId = new Map<string, number>();
    for (const membership of memberships) {
      membershipCountByUserId.set(
        membership.principalId,
        (membershipCountByUserId.get(membership.principalId) ?? 0) + 1,
      );
    }
    const adminIds = new Set(
      await Promise.all(
        userIds.map(async (userId) =>
          (await access.isInstanceAdmin(userId)) ? userId : null,
        ),
      ).then((values) => values.filter((value): value is string => Boolean(value))),
    );

    res.json(
      filteredUsers.slice(0, 50).map((user) => ({
        ...toUserProfile(user),
        isInstanceAdmin: adminIds.has(user.id),
        activeSpaceMembershipCount:
          membershipCountByUserId.get(user.id) ?? 0,
      })),
    );
  });

  router.post(
    "/admin/users/:userId/demote-instance-admin",
    async (req, res) => {
      await assertInstanceAdmin(req);
      assertAccessAdminVisible();
      const userId = req.params.userId as string;
      const removed = await access.demoteInstanceAdmin(userId);
      if (!removed) throw notFound("Instance admin role not found");
      res.json(removed);
    }
  );

  router.get("/admin/users/:userId/space-access", async (req, res) => {
    await assertInstanceAdmin(req);
    assertAccessAdminVisible();
    const userId = req.params.userId as string;
    res.json(await loadUserSpaceAccessResponse(db, access, userId));
  });

  router.put(
    "/admin/users/:userId/space-access",
    validate(updateUserSpaceAccessSchema),
    async (req, res) => {
      await assertInstanceAdmin(req);
      assertAccessAdminVisible();
      const userId = req.params.userId as string;
      await access.setUserSpaceAccess(
        userId,
        req.body.spaceIds ?? [],
        { actorUserId: req.actor.userId ?? null },
      );
      res.json(await loadUserSpaceAccessResponse(db, access, userId));
    }
  );

  return router;
}
