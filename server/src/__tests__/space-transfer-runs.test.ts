import { randomUUID } from "node:crypto";
import { resolveExternalTestDatabaseUrl } from "./helpers/external-test-database.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@outpost/db";
import { sha256HexOfBytes } from "@outpost/shared/portability-hash";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  spaceTransferRunService,
  type SpaceTransferPartsIndex,
} from "../services/space-transfer-runs.js";

const externalTestDatabaseUrl = resolveExternalTestDatabaseUrl("OUTPOST_TRANSFER_LEDGER_TEST_DATABASE_URL");
const embeddedPostgresSupport = externalTestDatabaseUrl ? { supported: true } : await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Manifest-shaped fixture: the ledger only cares about an idempotency key and
// part names, so the fixture is built inline rather than through any container
// packer. Distinct content per call: identical content intentionally derives
// the same idempotency key, which would make separate tests resume each
// other's runs.
const fixtureId = randomUUID();
let manifestSeq = 0;
function demoManifest(): SpaceTransferPartsIndex & { idempotencyKey: string } {
  manifestSeq += 1;
  return {
    idempotencyKey: sha256HexOfBytes(Buffer.from(`transfer-run-fixture-${fixtureId}-${manifestSeq}`)),
    chunks: [{ name: "chunks/0000.json.gz" }, { name: "chunks/0001.json.gz" }],
    blobs: [{ name: `blobs/${sha256HexOfBytes(pngBytes)}` }],
  };
}

describeEmbeddedPostgres("spaceTransferRunService", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db!: ReturnType<typeof createDb>;

  beforeAll(async () => {
    if (!externalTestDatabaseUrl) tempDb = await startEmbeddedPostgresTestDatabase("outpost-transfer-runs-");
    db = createDb(externalTestDatabaseUrl ?? tempDb!.connectionString);
  });

  afterAll(async () => {
    await db?.$client.end({ timeout: 1 });
    await tempDb?.cleanup();
  });

  it("creates a run, records parts idempotently, and resumes from the remainder", async () => {
    const manifest = demoManifest();
    const created = await spaceTransferRunService.resumeOrCreate(db, {
      direction: "import",
      actorKey: "user:alice",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
    });
    expect(created.resumed).toBe(false);
    expect(created.run.status).toBe("pending");

    await spaceTransferRunService.recordManifest(
      db,
      created.run.id,
      manifest,
      sha256HexOfBytes(Buffer.from(JSON.stringify(manifest))),
    );
    await spaceTransferRunService.start(db, created.run.id);

    const firstChunk = manifest.chunks[0]!.name;
    await spaceTransferRunService.completePart(db, created.run.id, firstChunk);
    // Re-completing the same part must not double-count.
    await spaceTransferRunService.completePart(db, created.run.id, firstChunk);

    const midway = (await spaceTransferRunService.getRun(db, created.run.id))!;
    expect(midway.status).toBe("running");
    expect(midway.completedParts).toEqual([firstChunk]);
    expect(midway.chunkCount).toBe(manifest.chunks.length);
    expect(midway.blobCount).toBe(manifest.blobs.length);

    const remaining = spaceTransferRunService.remainingParts(midway, manifest);
    expect(remaining).toEqual([
      manifest.chunks[1]!.name,
      ...manifest.blobs.map((blob) => blob.name),
    ]);

    // Simulate an interruption: the run fails, then the same content retries.
    await spaceTransferRunService.fail(db, created.run.id, "connection dropped");
    const resumed = await spaceTransferRunService.resumeOrCreate(db, {
      direction: "import",
      actorKey: "user:alice",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
    });
    expect(resumed.resumed).toBe(true);
    expect(resumed.alreadyCompleted).toBe(false);
    expect(resumed.run.id).toBe(created.run.id);
    expect(resumed.run.completedParts).toEqual([firstChunk]);

    await spaceTransferRunService.start(db, resumed.run.id);
    for (const part of spaceTransferRunService.remainingParts(resumed.run, manifest)) {
      await spaceTransferRunService.completePart(db, resumed.run.id, part);
    }
    await spaceTransferRunService.complete(db, resumed.run.id);

    const done = (await spaceTransferRunService.getRun(db, created.run.id))!;
    expect(done.status).toBe("completed");
    expect(done.error).toBeNull();
    expect(spaceTransferRunService.remainingParts(done, manifest)).toEqual([]);

    // A retry of identical content after completion short-circuits.
    const retried = await spaceTransferRunService.resumeOrCreate(db, {
      direction: "import",
      actorKey: "user:alice",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
    });
    expect(retried.alreadyCompleted).toBe(true);
    expect(retried.run.id).toBe(created.run.id);
  });

  it("scopes resume to the actor and direction", async () => {
    const manifest = demoManifest();
    const aliceRun = await spaceTransferRunService.resumeOrCreate(db, {
      direction: "export",
      actorKey: "user:alice",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "relay", prefix: "staging/a" },
    });

    const bobRun = await spaceTransferRunService.resumeOrCreate(db, {
      direction: "export",
      actorKey: "user:bob",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "relay", prefix: "staging/b" },
    });
    expect(bobRun.resumed).toBe(false);
    expect(bobRun.run.id).not.toBe(aliceRun.run.id);

    const aliceImport = await spaceTransferRunService.resumeOrCreate(db, {
      direction: "import",
      actorKey: "user:alice",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "relay", prefix: "staging/a" },
    });
    expect(aliceImport.resumed).toBe(false);
    expect(aliceImport.run.id).not.toBe(aliceRun.run.id);

    expect(await spaceTransferRunService.getRunForActor(db, aliceRun.run.id, "user:bob")).toBeNull();
    expect(await spaceTransferRunService.getRunForActor(db, aliceRun.run.id, "user:alice")).not.toBeNull();
  });

  it("creates a single run for concurrent identical declarations", async () => {
    const manifest = demoManifest();
    const input = {
      direction: "import" as const,
      actorKey: "user:dave",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
    };
    // Without the advisory lock both callers can miss the lookup and both
    // insert; with it, exactly one inserts and the other resumes that row.
    const [first, second] = await Promise.all([
      spaceTransferRunService.resumeOrCreate(db, input),
      spaceTransferRunService.resumeOrCreate(db, input),
    ]);
    expect(first.run.id).toBe(second.run.id);
    expect([first.resumed, second.resumed].filter(Boolean)).toHaveLength(1);
    expect(first.alreadyCompleted).toBe(false);
    expect(second.alreadyCompleted).toBe(false);
  });

  it("grants the apply claim to exactly one concurrent caller", async () => {
    const manifest = demoManifest();
    const { run } = await spaceTransferRunService.resumeOrCreate(db, {
      direction: "import",
      actorKey: "user:erin",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
    });
    await spaceTransferRunService.start(db, run.id);

    const claims = await Promise.all([
      spaceTransferRunService.claimApply(db, run.id),
      spaceTransferRunService.claimApply(db, run.id),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect((await spaceTransferRunService.getRun(db, run.id))!.status).toBe("applying");

    // A concurrent re-declaration resumes the mid-apply run instead of
    // spawning a duplicate, but start() must not restart it.
    const redeclared = await spaceTransferRunService.resumeOrCreate(db, {
      direction: "import",
      actorKey: "user:erin",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
    });
    expect(redeclared.run.id).toBe(run.id);
    expect(redeclared.resumed).toBe(true);
    expect(redeclared.alreadyCompleted).toBe(false);
    await spaceTransferRunService.start(db, run.id);
    expect((await spaceTransferRunService.getRun(db, run.id))!.status).toBe("applying");

    // A failed apply releases the claim: the run is retryable again.
    await spaceTransferRunService.fail(db, run.id, "import blew up");
    expect(await spaceTransferRunService.claimApply(db, run.id)).toBe(true);
    await spaceTransferRunService.complete(db, run.id);
    expect((await spaceTransferRunService.getRun(db, run.id))!.status).toBe("completed");
    expect(await spaceTransferRunService.claimApply(db, run.id)).toBe(false);
  });

  it("records parts only while the run is open", async () => {
    const manifest = demoManifest();
    const { run } = await spaceTransferRunService.resumeOrCreate(db, {
      direction: "import",
      actorKey: "user:frank",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
    });
    await spaceTransferRunService.start(db, run.id);
    expect(await spaceTransferRunService.completePart(db, run.id, "part-0")).toBe(true);

    await spaceTransferRunService.fail(db, run.id, "swept");
    expect(await spaceTransferRunService.completePart(db, run.id, "part-1")).toBe(false);
    expect((await spaceTransferRunService.getRun(db, run.id))!.completedParts).toEqual(["part-0"]);
  });

  it("claims an abandoned run only while it is open and still idle", async () => {
    const manifest = demoManifest();
    const { run } = await spaceTransferRunService.resumeOrCreate(db, {
      direction: "import",
      actorKey: "user:grace",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
    });
    await spaceTransferRunService.start(db, run.id);

    // Fresh activity: a cutoff in the past misses the guard.
    const past = new Date(Date.now() - 60 * 60 * 1000);
    expect(await spaceTransferRunService.cancelIfIdle(db, run.id, past, "stale")).toBe(false);
    expect((await spaceTransferRunService.getRun(db, run.id))!.status).toBe("running");

    // Idle past the cutoff: exactly this claim cancels the run.
    const future = new Date(Date.now() + 60 * 60 * 1000);
    expect(await spaceTransferRunService.cancelIfIdle(db, run.id, future, "stale")).toBe(true);
    const swept = (await spaceTransferRunService.getRun(db, run.id))!;
    expect(swept.status).toBe("cancelled");
    expect(swept.error).toBe("stale");
    // Terminal already — a second claim finds nothing to do.
    expect(await spaceTransferRunService.cancelIfIdle(db, run.id, future, "stale")).toBe(false);
    // Cancelled, not failed, so the swept run can never be claimed for an
    // apply while its spool is being deleted.
    expect(await spaceTransferRunService.claimApply(db, run.id)).toBe(false);
  });

  it("releases an apply claim without ever reopening a settled run", async () => {
    const manifest = demoManifest();
    const { run } = await spaceTransferRunService.resumeOrCreate(db, {
      direction: "import",
      actorKey: "user:heidi",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
    });
    await spaceTransferRunService.start(db, run.id);

    // Releasing a held claim fails the run and makes it claimable again.
    expect(await spaceTransferRunService.claimApply(db, run.id)).toBe(true);
    expect(await spaceTransferRunService.releaseApplyClaim(db, run.id, "import blew up")).toBe(true);
    const released = (await spaceTransferRunService.getRun(db, run.id))!;
    expect(released.status).toBe("failed");
    expect(released.error).toBe("import blew up");
    expect(await spaceTransferRunService.claimApply(db, run.id)).toBe(true);

    // Guarded on "applying": after complete() settles the claim, a late
    // release (e.g. a cleanup error caught after success) is a no-op — the
    // run stays completed and can never be flipped back to claimable.
    await spaceTransferRunService.complete(db, run.id);
    expect(await spaceTransferRunService.releaseApplyClaim(db, run.id, "cleanup failed")).toBe(false);
    const settled = (await spaceTransferRunService.getRun(db, run.id))!;
    expect(settled.status).toBe("completed");
    expect(settled.error).toBeNull();
    expect(await spaceTransferRunService.claimApply(db, run.id)).toBe(false);
  });

  it("recovers runs stranded in applying by a restart, leaving live runs alone", async () => {
    const strandedManifest = demoManifest();
    const { run: stranded } = await spaceTransferRunService.resumeOrCreate(db, {
      direction: "import",
      actorKey: "user:ivan",
      idempotencyKey: strandedManifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
    });
    await spaceTransferRunService.start(db, stranded.id);
    expect(await spaceTransferRunService.claimApply(db, stranded.id)).toBe(true);

    const openManifest = demoManifest();
    const { run: open } = await spaceTransferRunService.resumeOrCreate(db, {
      direction: "import",
      actorKey: "user:ivan",
      idempotencyKey: openManifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
    });
    await spaceTransferRunService.start(db, open.id);

    // The process "restarted": the in-memory apply for the claimed run is
    // gone, so startup recovery fails it and makes it claimable again.
    const recovered = await spaceTransferRunService.recoverStrandedApplyingRuns(db);
    expect(recovered).toContain(stranded.id);
    expect(recovered).not.toContain(open.id);
    const failed = (await spaceTransferRunService.getRun(db, stranded.id))!;
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("apply interrupted by a restart — verify whether the import completed before retrying");
    expect(await spaceTransferRunService.claimApply(db, stranded.id)).toBe(true);

    // Runs that were merely uploading are untouched.
    expect((await spaceTransferRunService.getRun(db, open.id))!.status).toBe("running");
  });

  it("does not restart a cancelled run", async () => {
    const manifest = demoManifest();
    const { run } = await spaceTransferRunService.resumeOrCreate(db, {
      direction: "import",
      actorKey: "user:carol",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
    });
    await spaceTransferRunService.cancel(db, run.id);
    await spaceTransferRunService.start(db, run.id);
    expect((await spaceTransferRunService.getRun(db, run.id))!.status).toBe("cancelled");

    // Cancelled runs are not resumed; the same content starts a fresh run.
    const fresh = await spaceTransferRunService.resumeOrCreate(db, {
      direction: "import",
      actorKey: "user:carol",
      idempotencyKey: manifest.idempotencyKey,
      containerRef: { kind: "zip-upload" },
    });
    expect(fresh.resumed).toBe(false);
    expect(fresh.run.id).not.toBe(run.id);
  });
});
