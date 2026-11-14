import { spaces, createDb } from "../packages/db/src/index.js";
import { loadConfig } from "../server/src/config.js";
import { issueReferenceService } from "../server/src/services/issue-references.js";

function parseFlag(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

async function main() {
  const config = loadConfig();
  const dbUrl =
    process.env.DATABASE_URL?.trim()
    || config.databaseUrl
    || `postgres://outpost:outpost@127.0.0.1:${config.embeddedPostgresPort}/outpost`;

  const db = createDb(dbUrl);
  const refs = issueReferenceService(db);
  const spaceId = parseFlag("--space");
  const spaceRows = spaceId
    ? [{ id: spaceId }]
    : await db.select({ id: spaces.id }).from(spaces);

  if (spaceRows.length === 0) {
    console.log("No spaces found; nothing to backfill.");
    return;
  }

  console.log(`Backfilling issue reference mentions for ${spaceRows.length} compan${spaceRows.length === 1 ? "y" : "ies"}...`);
  for (const space of spaceRows) {
    console.log(`- ${space.id}`);
    await refs.syncAllForSpace(space.id);
  }
  console.log("Issue reference backfill complete.");
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Issue reference backfill failed: ${message}`);
  process.exitCode = 1;
});
