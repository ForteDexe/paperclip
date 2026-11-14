import { closeRegisteredClients, createDb } from "@outpost/db";
import { getStorageService } from "../src/storage/index.js";
import { migrateRemoteWorkspace } from "../src/services/remote-workspace-migration.js";
import { assertRemoteWorkspacePersistence } from "../src/services/remote-workspaces.js";

const args = process.argv.slice(2);
const allowed = new Set(["--space-id", "--workspace-id", "--dry-run", "--apply"]);
function identifier(name: string) {
  const value = args[args.indexOf(name) + 1];
  if (!args.includes(name) || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value ?? "")) throw new Error(`${name} requires a UUID`);
  return value!;
}
try {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!; if (!allowed.has(arg)) throw new Error(`Unknown argument: ${arg}`);
    if (arg === "--space-id" || arg === "--workspace-id") index++;
  }
  if (args.includes("--dry-run") && args.includes("--apply")) throw new Error("Select either --dry-run or --apply");
  const spaceId = identifier("--space-id"), workspaceId = identifier("--workspace-id");
  const storage = getStorageService();
  const { databaseUrl } = assertRemoteWorkspacePersistence(storage);
  const db = createDb(databaseUrl);
  try { process.stdout.write(`${JSON.stringify(await migrateRemoteWorkspace({ db, storage, spaceId, workspaceId, apply: args.includes("--apply") }), null, 2)}\n`); }
  finally { await closeRegisteredClients(databaseUrl, { scope: "database" }); }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Remote workspace migration failed"}\n`);
  process.exitCode = 1;
}
