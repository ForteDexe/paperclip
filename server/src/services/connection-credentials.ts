import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { spaceSecrets, spaceSecretVersions, spaceSecretProposals, managedAgentProfiles, routineTriggers, userSecretDefinitions, type Db, type connectionGrants, type toolConnections } from "@outpost/db";
import type { ToolCredentialSecretRef } from "@outpost/shared";
import { connectionCredentialConfigPath } from "@outpost/shared";
import { unprocessable } from "../errors.js";
import { secretService } from "./secrets.js";

export { connectionCredentialConfigPath } from "@outpost/shared";

type CredentialDb = Parameters<typeof secretService>[0];
type SecretActor = Parameters<ReturnType<typeof secretService>["create"]>[2];
type ConsumerContext = NonNullable<Parameters<ReturnType<typeof secretService>["resolveUserSecretValue"]>[2]>;

/** These consumers reference secrets directly, without connection bindings. */
export async function connectionSecretsUsedByOtherConsumers(db: CredentialDb, secretIds: string[]) {
  if (!secretIds.length) return new Set<string>();
  const profiles = await db.select({ secretId: managedAgentProfiles.apiKeySecretId }).from(managedAgentProfiles)
    .where(inArray(managedAgentProfiles.apiKeySecretId, secretIds));
  const triggers = await db.select({ secretId: routineTriggers.secretId }).from(routineTriggers)
    .where(inArray(routineTriggers.secretId, secretIds));
  const proposals = await db.select({ secretId: spaceSecretProposals.secretId, createdSecretId: spaceSecretProposals.createdSecretId })
    .from(spaceSecretProposals).where(or(inArray(spaceSecretProposals.secretId, secretIds), inArray(spaceSecretProposals.createdSecretId, secretIds)));
  return new Set([...profiles, ...triggers, ...proposals, ...proposals.map((row) => ({ secretId: row.createdSecretId }))]
    .flatMap((row) => row.secretId ? [row.secretId] : []));
}

export function connectionGrantCredentialRef(
  grant: Pick<typeof connectionGrants.$inferSelect, "credentialSecretRefs">,
  ref: { name: string },
): ToolCredentialSecretRef | undefined {
  return grant.credentialSecretRefs.find((candidate) =>
    candidate.configPath === ref.name || candidate.configPath === connectionCredentialConfigPath(ref),
  );
}

/** Create/replace invocation credentials in the selected identity's vault. */
export async function writeConnectionCredential(
  db: CredentialDb,
  input: {
    spaceId: string;
    connectionName: string;
    configPath: string;
    label: string;
    value: string;
    ownerUserId?: string | null;
    existingRef?: ToolCredentialSecretRef;
    /** OAuth shares one definition per connection/path, with one value per owner. */
    definitionKey?: string;
    actor?: SecretActor;
    /** Only the OAuth refresh owner may retain the existing credential identity. */
    preserveOAuthIdentity?: boolean;
  },
) {
  const vault = secretService(db);
  if (input.existingRef) {
    const [existing] = await db.select().from(spaceSecrets).where(and(
      eq(spaceSecrets.id, input.existingRef.secretId),
      eq(spaceSecrets.spaceId, input.spaceId),
    )).limit(1);
    if (existing?.scope === "user" && existing.ownerUserId !== input.ownerUserId) {
      throw unprocessable("Reconnect this connection as its credential owner.", { code: "grant_credential_invalid" });
    }
    if (existing?.status === "active" && (input.ownerUserId
      ? existing.scope === "user" && Boolean(existing.userSecretDefinitionId)
      : existing.scope === "space")) {
      const secret = input.ownerUserId
        ? await vault.rotateCurrentUserSecretValue(input.spaceId, input.ownerUserId, existing.id,
          { value: input.value, preserveAiSessionEpoch: input.preserveOAuthIdentity }, input.actor)
        : await vault.rotate(existing.id, { value: input.value, preserveAiSessionEpoch: input.preserveOAuthIdentity }, input.actor);
      return { secret, created: false, definitionId: null };
    }
    // Re-entering a credential is fresh consent. Replace a legacy space
    // secret with a new owner value; never rotate or adopt the old shared row.
  }
  const metadata = {
    name: `${input.connectionName} ${input.label} ${randomUUID().slice(0, 8)}`,
    key: `tool_app.${randomUUID()}.${input.configPath.replace(/[^a-z0-9_:-]+/gi, "_")}`,
    provider: "local_encrypted" as const,
    description: `Credential for ${input.connectionName} (${input.configPath}).`,
  };
  if (!input.ownerUserId) {
    return { secret: await vault.create(input.spaceId, { ...metadata, value: input.value }, input.actor), created: true, definitionId: null };
  }
  let definition = input.definitionKey ? (await db.select().from(userSecretDefinitions).where(and(
    eq(userSecretDefinitions.spaceId, input.spaceId), eq(userSecretDefinitions.key, input.definitionKey),
    isNull(userSecretDefinitions.deletedAt),
  )).limit(1))[0] : undefined;
  let createdDefinitionId: string | null = null;
  if (!definition) {
    if (input.definitionKey) {
      [definition] = await db.insert(userSecretDefinitions).values({
        ...metadata, key: input.definitionKey, spaceId: input.spaceId,
        managedMode: "outpost_managed", createdByUserId: input.actor?.userId, createdByAgentId: input.actor?.agentId,
      }).onConflictDoNothing().returning();
      if (definition) createdDefinitionId = definition.id;
      else [definition] = await db.select().from(userSecretDefinitions).where(and(
        eq(userSecretDefinitions.spaceId, input.spaceId), eq(userSecretDefinitions.key, input.definitionKey),
        isNull(userSecretDefinitions.deletedAt),
      )).limit(1);
    } else {
      definition = await vault.createUserSecretDefinition(input.spaceId, metadata, input.actor);
      createdDefinitionId = definition.id;
    }
  }
  if (!definition) throw unprocessable("Reconnect this connection to restore its credential definition.", { code: "grant_credential_invalid" });
  const [ownerValue] = await db.select().from(spaceSecrets).where(and(
    eq(spaceSecrets.spaceId, input.spaceId), eq(spaceSecrets.scope, "user"),
    eq(spaceSecrets.ownerUserId, input.ownerUserId), eq(spaceSecrets.userSecretDefinitionId, definition.id),
    ne(spaceSecrets.status, "deleted"),
  )).limit(1);
  if (ownerValue) {
    if (ownerValue.status !== "active") await vault.updateCurrentUserSecretValue(input.spaceId, input.ownerUserId, ownerValue.id,
      { status: "active" }, input.actor);
    return { secret: await vault.rotateCurrentUserSecretValue(input.spaceId, input.ownerUserId, ownerValue.id,
      { value: input.value }, input.actor), created: false, definitionId: createdDefinitionId };
  }
  const secret = await vault.createCurrentUserSecretValue(input.spaceId, input.ownerUserId,
    { definitionId: definition.id, value: input.value }, input.actor);
  return { secret, created: true, definitionId: createdDefinitionId };
}

const credentialSecretColumns = {
  id: spaceSecrets.id, spaceId: spaceSecrets.spaceId, scope: spaceSecrets.scope,
  ownerUserId: spaceSecrets.ownerUserId, userSecretDefinitionId: spaceSecrets.userSecretDefinitionId,
  status: spaceSecrets.status, deletedAt: spaceSecrets.deletedAt, latestVersion: spaceSecrets.latestVersion,
  updatedAt: spaceSecrets.updatedAt,
};
type CredentialConnection = Pick<typeof toolConnections.$inferSelect, "id" | "spaceId">;
type CredentialGrantOwner = Pick<typeof connectionGrants.$inferSelect,
  "id" | "spaceId" | "connectionId" | "kind" | "subjectUserId">;
type CredentialSecretOwner = Pick<typeof spaceSecrets.$inferSelect,
  "id" | "spaceId" | "scope" | "ownerUserId" | "userSecretDefinitionId">;
function assertConnectionGrantSecretOwnership(connection: CredentialConnection, grant: CredentialGrantOwner,
  ref: ToolCredentialSecretRef, secret: CredentialSecretOwner | undefined) {
  const personal = grant.kind === "user";
  if (grant.spaceId !== connection.spaceId || grant.connectionId !== connection.id || !secret
    || secret.spaceId !== connection.spaceId || (personal
      ? !grant.subjectUserId || secret.scope !== "user" || secret.ownerUserId !== grant.subjectUserId || !secret.userSecretDefinitionId
      : secret.scope !== "space")) {
    throw unprocessable("This connection's credential does not belong to the selected identity. Its owner must reconnect it.", {
      code: "grant_credential_invalid", connectionId: connection.id, grantId: grant.id, credential: ref.configPath,
    });
  }
}
export async function validateConnectionGrantSecretOwnership(db: Pick<Db, "select">,
  connection: CredentialConnection, grant: CredentialGrantOwner, ref: ToolCredentialSecretRef) {
  const [secret] = await db.select(credentialSecretColumns).from(spaceSecrets).where(and(
    eq(spaceSecrets.id, ref.secretId), eq(spaceSecrets.spaceId, connection.spaceId),
  )).limit(1);
  assertConnectionGrantSecretOwnership(connection, grant, ref, secret);
  return secret!;
}

/** The same owner/declaration checks apply during setup, testing and execution. */
export async function resolveConnectionGrantSecret(
  db: CredentialDb,
  connection: Pick<typeof toolConnections.$inferSelect, "id" | "spaceId">,
  grant: Pick<typeof connectionGrants.$inferSelect, "id" | "spaceId" | "connectionId" | "kind" | "subjectUserId">,
  ref: ToolCredentialSecretRef,
  context: ConsumerContext,
) {
  const secret = await validateConnectionGrantSecretOwnership(db, connection, grant, ref);
  const personal = grant.kind === "user";
  const accessContext = { ...context, consumerType: "tool_connection" as const, consumerId: connection.id,
    configPath: ref.configPath, responsibleUserId: grant.subjectUserId };
  const vault = secretService(db);
  if (!personal) {
    return { value: await vault.resolveSecretValue(connection.spaceId, ref.secretId, ref.versionSelector ?? "latest",
      { accessContext }), latestVersion: secret.latestVersion };
  }
  const resolved = await vault.resolveUserSecretValue(connection.spaceId, {
    definitionId: secret.userSecretDefinitionId!, responsibleUserId: grant.subjectUserId!,
    version: ref.versionSelector ?? "latest", required: ref.required ?? true,
  }, accessContext);
  if (!resolved) throw unprocessable("Your credential is missing. Reconnect this connection.", {
    code: "user_secret_missing", connectionId: connection.id, grantId: grant.id, credential: ref.configPath,
  });
  return { value: resolved.value, latestVersion: secret.latestVersion };
}

type CredentialGrant = CredentialGrantOwner & Pick<typeof connectionGrants.$inferSelect, "credentialSecretRefs">;
export type ConnectionGrantCredentialInput = { connection: CredentialConnection; grant: CredentialGrant };
export async function readConnectionGrantCredentialStates(db: Pick<Db, "select">,
  inputs: ConnectionGrantCredentialInput[], checkBudget: () => void = () => {}): Promise<Map<string, unknown[]> | undefined> {
  if (inputs.length > 10_000) return;
  const states = new Map<string, unknown[]>();
  const requests: { input: ConnectionGrantCredentialInput; ref: ToolCredentialSecretRef }[] = [];
  for (const input of inputs) {
    checkBudget();
    if (states.has(input.grant.id)) return;
    states.set(input.grant.id, []);
    const paths = new Set<string>();
    for (const ref of input.grant.credentialSecretRefs) {
      checkBudget();
      if (!["oauth.access_token", "oauth.refresh_token"].includes(ref.configPath)) continue;
      if (paths.has(ref.configPath)) return;
      paths.add(ref.configPath);
      requests.push({ input, ref });
    }
    if (!paths.has("oauth.access_token")) return;
  }
  if (requests.length > 20_000) return;
  for (let offset = 0; offset < requests.length; offset += 1000) {
    checkBudget();
    const chunk = requests.slice(offset, offset + 1000);
    const ids = [...new Set(chunk.map(request => request.ref.secretId))];
    const rows = await db.select({ secret: credentialSecretColumns, definition: {
      id: userSecretDefinitions.id, spaceId: userSecretDefinitions.spaceId, status: userSecretDefinitions.status,
      deletedAt: userSecretDefinitions.deletedAt, updatedAt: userSecretDefinitions.updatedAt,
    } }).from(spaceSecrets).leftJoin(userSecretDefinitions, eq(userSecretDefinitions.id, spaceSecrets.userSecretDefinitionId))
      .where(inArray(spaceSecrets.id, ids)).orderBy(spaceSecrets.id).limit(1001);
    if (rows.length > ids.length) return;
    const secrets = new Map(rows.map(row => [row.secret.id, row]));
    if (secrets.size !== rows.length) return;
    const selected = [];
    const pairs = new Map<string, { secretId: string; version: number }>();
    for (const request of chunk) {
      checkBudget();
      const row = secrets.get(request.ref.secretId);
      try { assertConnectionGrantSecretOwnership(request.input.connection, request.input.grant, request.ref, row?.secret); }
      catch (error) {
        if (error && typeof error === "object" && "status" in error && error.status === 422) return;
        throw error;
      }
      if (!row) return;
      const { secret, definition } = row;
      if (secret.status !== "active" || secret.deletedAt || !Number.isSafeInteger(secret.latestVersion) || secret.latestVersion <= 0) return;
      if (secret.scope === "user" && (!definition || definition.id !== secret.userSecretDefinitionId
        || definition.spaceId !== request.input.connection.spaceId || definition.status !== "active" || definition.deletedAt)) return;
      const version = request.ref.versionSelector === undefined || request.ref.versionSelector === "latest"
        ? secret.latestVersion : request.ref.versionSelector;
      if (typeof version !== "number" || !Number.isSafeInteger(version) || version <= 0) return;
      const key = JSON.stringify([secret.id, version]);
      pairs.set(key, { secretId: secret.id, version });
      selected.push({ request, secret, definition: secret.scope === "user" ? definition : undefined, key });
    }
    checkBudget();
    const versions = await db.select({ id: spaceSecretVersions.id, secretId: spaceSecretVersions.secretId,
      version: spaceSecretVersions.version, status: spaceSecretVersions.status, revokedAt: spaceSecretVersions.revokedAt })
      .from(spaceSecretVersions).where(or(...[...pairs.values()].map(pair => and(
        eq(spaceSecretVersions.secretId, pair.secretId), eq(spaceSecretVersions.version, pair.version)))))
      .orderBy(spaceSecretVersions.secretId, spaceSecretVersions.version).limit(1001);
    if (versions.length > pairs.size) return;
    const saved = new Map(versions.map(version => [JSON.stringify([version.secretId, version.version]), version]));
    if (saved.size !== versions.length || versions.some(version => !pairs.has(JSON.stringify([version.secretId, version.version])))) return;
    for (const { request, secret, definition, key } of selected) {
      checkBudget();
      const version = saved.get(key);
      if (!version || !["current", "previous"].includes(version.status) || version.revokedAt) return;
      states.get(request.input.grant.id)!.push([request.ref.configPath, secret.id, secret.scope, secret.ownerUserId,
        secret.latestVersion, secret.updatedAt, definition, version]);
    }
  }
  return states;
}
export async function readConnectionGrantCredentialState(db: Pick<Db, "select">,
  connection: CredentialConnection, grant: CredentialGrant): Promise<unknown[] | undefined> {
  return (await readConnectionGrantCredentialStates(db, [{ connection, grant }]))?.get(grant.id);
}
