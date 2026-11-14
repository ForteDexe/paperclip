import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveInlineSourceFromPath } from "../commands/client/space.js";
import { createStoredZipArchive } from "./helpers/zip.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("resolveInlineSourceFromPath", () => {
  it("imports portable files from a zip archive instead of scanning the parent directory", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "outpost-space-import-zip-"));
    tempDirs.push(tempDir);

    const blobBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
    const archivePath = path.join(tempDir, "outpost-demo.zip");
    const archive = createStoredZipArchive(
      {
        "COMPANY.md": "# Space\n",
        ".outpost.yaml": "schema: outpost/v1\n",
        "agents/lead/AGENT.md": "# Default agent\n",
        "blobs/4f2d1c9a": blobBytes,
        "notes/todo.txt": "ignore me\n",
      },
      "outpost-demo",
    );
    await writeFile(archivePath, archive);

    const resolved = await resolveInlineSourceFromPath(archivePath);

    expect(resolved).toEqual({
      rootPath: "outpost-demo",
      files: {
        "COMPANY.md": "# Space\n",
        ".outpost.yaml": "schema: outpost/v1\n",
        "agents/lead/AGENT.md": "# Default agent\n",
        "blobs/4f2d1c9a": {
          encoding: "base64",
          data: Buffer.from(blobBytes).toString("base64"),
          contentType: "application/octet-stream",
        },
      },
    });
  });
});
