import { constants, createReadStream } from "node:fs";
import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

// The marker survives process replacement on persistent instance storage.
// It contains no credentials or tenant data, and never substitutes for a dump.
export const idleBackupWakeMarker = (directory: string) => path.join(directory, ".idle-backup-wake-required");

async function syncDirectory(directory: string): Promise<void> {
  let handle;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Windows does not support opening/fsyncing directory handles through
    // Node's file API. File contents are still fsynced before this call.
    if (process.platform !== "win32" || !["EPERM", "EACCES", "EINVAL"].includes(code ?? "")) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

async function syncReadOnlyFile(handle: Awaited<ReturnType<typeof open>>): Promise<void> {
  try {
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // FlushFileBuffers rejects read-only handles on Windows. The backup
    // producer has already closed its writer before verification begins.
    if (process.platform !== "win32" || !["EPERM", "EACCES", "EINVAL"].includes(code ?? "")) {
      throw error;
    }
  }
}

export async function markIdleBackupWakeRequired(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const marker = await open(idleBackupWakeMarker(directory), constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    await marker.writeFile("Take a fresh database backup after this process restarts.\n");
    await marker.sync();
  } finally { await marker.close(); }
  await syncDirectory(directory);
}

/** Read the entire archive to verify the gzip trailer, then persist its bytes
 * and directory entry before allowing compute to stop. The backup runner
 * retains its in-flight receipt until this function settles. */
export async function verifyIdleDatabaseBackup(backupFile: string): Promise<void> {
  const handle = await open(backupFile, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size === 0) throw new Error("Idle backup archive is empty or invalid");
    let bytes = 0;
    await pipeline(
      createReadStream(backupFile, { fd: handle.fd, autoClose: false }),
      createGunzip(),
      new Writable({ write(chunk, _encoding, done) { bytes += chunk.length; done(); } }),
    );
    if (bytes === 0) throw new Error("Idle backup archive contains no SQL");
    await syncReadOnlyFile(handle);
  } finally { await handle.close(); }
  await syncDirectory(path.dirname(backupFile));
}

export async function clearIdleBackupWakeRequired(directory: string): Promise<void> {
  await unlink(idleBackupWakeMarker(directory)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  await syncDirectory(directory);
}
