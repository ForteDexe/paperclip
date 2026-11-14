import { resolveExternalTestDatabaseUrl } from "./helpers/external-test-database.js";
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  activityLog,
  authUsers,
  cases,
  spaces,
  spaceMemberships,
  createDb,
  instanceUserRoles,
  issues,
  principalPermissionGrants,
} from "@outpost/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { cloudActorHeaderSourceFromHeaders, resolveCloudTenantActor } from "../middleware/auth.js";

const external = resolveExternalTestDatabaseUrl("OUTPOST_CLOUD_PROVISIONING_TEST_DATABASE_URL");
const embeddedPostgresSupport = external ? { supported: true, reason: undefined } : await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres tenant provisioning tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

const SERVER_TOKEN = "test-server-token";

function tenantHeaders(input: { stackId: string; userId: string; spaceName?: string }) {
  const headers: Record<string, string> = {
    "x-outpost-cloud-tenant-token": SERVER_TOKEN,
    "x-outpost-cloud-user-id": input.userId,
    "x-outpost-cloud-user-email": `${input.userId}@example.com`,
    "x-outpost-cloud-stack-id": input.stackId,
    "x-outpost-cloud-stack-role": "owner",
  };
  if (input.spaceName) headers["x-outpost-cloud-outpost-space-name"] = input.spaceName;
  return cloudActorHeaderSourceFromHeaders(headers);
}

/**
 * The prefix a pre-name-derivation build wrote. Pinned here on purpose: the
 * repair detects legacy rows by this exact value, so it must keep matching
 * what those builds produced.
 */
function legacyProvisionedPrefix(stackId: string) {
  return `PC${createHash("sha256").update(stackId).digest("hex").slice(0, 4).toUpperCase()}`;
}

function legacyProvisionedDescription(stackId: string) {
  return `Provisioned by Outpost Cloud for stack ${stackId}.`;
}

describeEmbeddedPostgres("cloud tenant space provisioning", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    if (!external) tempDb = await startEmbeddedPostgresTestDatabase("outpost-tenant-provisioning-");
    db = createDb(external ?? tempDb!.connectionString);
  }, 20_000);

  beforeEach(() => {
    process.env.OUTPOST_CLOUD_TENANT_SERVER_TOKEN = SERVER_TOKEN;
  });

  afterEach(async () => {
    delete process.env.OUTPOST_CLOUD_TENANT_SERVER_TOKEN;
    await db.delete(activityLog);
    await db.delete(principalPermissionGrants);
    await db.delete(spaceMemberships);
    await db.delete(cases);
    await db.delete(issues);
    await db.delete(spaces);
    await db.delete(instanceUserRoles);
    await db.delete(authUsers);
  });

  afterAll(async () => {
    await db?.$client.end({ timeout: 1 });
    await tempDb?.cleanup();
  });

  async function readSpace(spaceId: string) {
    return db
      .select({
        name: spaces.name,
        issuePrefix: spaces.issuePrefix,
        description: spaces.description,
      })
      .from(spaces)
      .where(eq(spaces.id, spaceId))
      .then((rows) => rows[0] ?? null);
  }

  async function readIdentifiers(spaceId: string) {
    const issueRows = await db
      .select({ identifier: issues.identifier })
      .from(issues)
      .where(eq(issues.spaceId, spaceId));
    const caseRows = await db
      .select({ identifier: cases.identifier })
      .from(cases)
      .where(eq(cases.spaceId, spaceId));
    return {
      issues: issueRows.map((row) => row.identifier).sort(),
      cases: caseRows.map((row) => row.identifier).sort(),
    };
  }

  describe("claim time", () => {
    it("derives the issue prefix from the space name and writes no placeholder description", async () => {
      const actor = await resolveCloudTenantActor(
        db,
        tenantHeaders({ stackId: "stack-claim-1", userId: "user-claim-1", spaceName: "Acme Robotics" }),
      );

      const spaceId = actor!.spaceIds![0]!;
      await expect(readSpace(spaceId)).resolves.toEqual({
        name: "Acme Robotics",
        issuePrefix: "ACM",
        description: null,
      });
    });

    it("derives the prefix from the humanized stack slug when no space name header is sent", async () => {
      const actor = await resolveCloudTenantActor(
        db,
        tenantHeaders({ stackId: "outpost-stack-borealis", userId: "user-claim-2" }),
      );

      const spaceId = actor!.spaceIds![0]!;
      await expect(readSpace(spaceId)).resolves.toMatchObject({
        name: "Borealis",
        issuePrefix: "BOR",
        description: null,
      });
    });

    it("suffixes the derived prefix when another space already holds it", async () => {
      await db.insert(spaces).values({ name: "Acme Holdings", issuePrefix: "ACM" });

      const actor = await resolveCloudTenantActor(
        db,
        tenantHeaders({ stackId: "stack-claim-3", userId: "user-claim-3", spaceName: "Acme Robotics" }),
      );

      const spaceId = actor!.spaceIds![0]!;
      await expect(readSpace(spaceId)).resolves.toMatchObject({
        name: "Acme Robotics",
        issuePrefix: "ACMA",
      });
    });
  });

  describe("legacy provisioning repair", () => {
    /**
     * Claims the space through the normal path, then rewrites it into the
     * shape a pre-name-derivation build left behind.
     */
    async function seedLegacySpace(input: {
      stackId: string;
      claimUserId: string;
      spaceName: string;
      issuePrefix?: string;
      description?: string | null;
    }) {
      const actor = await resolveCloudTenantActor(
        db,
        tenantHeaders({
          stackId: input.stackId,
          userId: input.claimUserId,
          spaceName: input.spaceName,
        }),
      );
      const spaceId = actor!.spaceIds![0]!;
      const issuePrefix = input.issuePrefix ?? legacyProvisionedPrefix(input.stackId);
      await db
        .update(spaces)
        .set({
          issuePrefix,
          description: input.description === undefined
            ? legacyProvisionedDescription(input.stackId)
            : input.description,
        })
        .where(eq(spaces.id, spaceId));
      await db.insert(issues).values([
        { spaceId, title: "First", issueNumber: 1, identifier: `${issuePrefix}-1` },
        { spaceId, title: "Second", issueNumber: 20, identifier: `${issuePrefix}-20` },
      ]);
      await db.insert(cases).values({
        spaceId,
        caseNumber: 4,
        identifier: `${issuePrefix}-C4`,
        caseType: "decision",
        title: "A case",
      });
      return { spaceId, issuePrefix };
    }

    it("re-derives the prefix, clears the placeholder, and re-keys both identifier tables", async () => {
      const stackId = "stack-repair-1";
      const { spaceId, issuePrefix: legacyPrefix } = await seedLegacySpace({
        stackId,
        claimUserId: "user-repair-seed-1",
        spaceName: "Acme Robotics",
      });

      await resolveCloudTenantActor(
        db,
        tenantHeaders({ stackId, userId: "user-repair-1", spaceName: "Acme Robotics" }),
      );

      await expect(readSpace(spaceId)).resolves.toEqual({
        name: "Acme Robotics",
        issuePrefix: "ACM",
        description: null,
      });
      await expect(readIdentifiers(spaceId)).resolves.toEqual({
        issues: ["ACM-1", "ACM-20"],
        cases: ["ACM-C4"],
      });

      const logged = await db
        .select({ details: activityLog.details })
        .from(activityLog)
        .where(and(
          eq(activityLog.spaceId, spaceId),
          eq(activityLog.action, "space.updated"),
        ));
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({
        details: {
          source: "cloud_tenant_auth",
          reason: "legacy_provision_defaults_repair",
          previousIssuePrefix: legacyPrefix,
          issuePrefix: "ACM",
          descriptionCleared: true,
          issuesRekeyed: 2,
          casesRekeyed: 1,
        },
      });
    });

    it("is a no-op on a second pass", async () => {
      const stackId = "stack-repair-2";
      const { spaceId } = await seedLegacySpace({
        stackId,
        claimUserId: "user-repair-seed-2",
        spaceName: "Acme Robotics",
      });

      await resolveCloudTenantActor(
        db,
        tenantHeaders({ stackId, userId: "user-repair-2a", spaceName: "Acme Robotics" }),
      );
      const afterFirstPass = await readSpace(spaceId);

      await resolveCloudTenantActor(
        db,
        tenantHeaders({ stackId, userId: "user-repair-2b", spaceName: "Acme Robotics" }),
      );

      await expect(readSpace(spaceId)).resolves.toEqual(afterFirstPass);
      await expect(readIdentifiers(spaceId)).resolves.toEqual({
        issues: ["ACM-1", "ACM-20"],
        cases: ["ACM-C4"],
      });
      // The repair logged once, on the pass that actually changed the row.
      const logged = await db
        .select({ id: activityLog.id })
        .from(activityLog)
        .where(and(
          eq(activityLog.spaceId, spaceId),
          eq(activityLog.action, "space.updated"),
        ));
      expect(logged).toHaveLength(1);
    });

    it("clears only the placeholder description when the prefix is not the legacy hash", async () => {
      const stackId = "stack-repair-3";
      const { spaceId } = await seedLegacySpace({
        stackId,
        claimUserId: "user-repair-seed-3",
        spaceName: "Acme Robotics",
        // A prefix the operator already re-derived or chose.
        issuePrefix: "ZEN",
      });

      await resolveCloudTenantActor(
        db,
        tenantHeaders({ stackId, userId: "user-repair-3", spaceName: "Acme Robotics" }),
      );

      await expect(readSpace(spaceId)).resolves.toEqual({
        name: "Acme Robotics",
        issuePrefix: "ZEN",
        description: null,
      });
      // Nothing was re-keyed, so the identifiers keep the prefix they had.
      await expect(readIdentifiers(spaceId)).resolves.toEqual({
        issues: ["ZEN-1", "ZEN-20"],
        cases: ["ZEN-C4"],
      });
      const logged = await db
        .select({ id: activityLog.id })
        .from(activityLog)
        .where(eq(activityLog.spaceId, spaceId));
      expect(logged).toHaveLength(0);
    });

    it("leaves an operator-written description alone while it re-derives the prefix", async () => {
      const stackId = "stack-repair-4";
      const { spaceId } = await seedLegacySpace({
        stackId,
        claimUserId: "user-repair-seed-4",
        spaceName: "Acme Robotics",
        description: "We build robots.",
      });

      await resolveCloudTenantActor(
        db,
        tenantHeaders({ stackId, userId: "user-repair-4", spaceName: "Acme Robotics" }),
      );

      await expect(readSpace(spaceId)).resolves.toEqual({
        name: "Acme Robotics",
        issuePrefix: "ACM",
        description: "We build robots.",
      });
    });
  });
});
