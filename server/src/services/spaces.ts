import fs from "node:fs/promises";
import path from "node:path";
import type { Db } from "@outpost/db";
import { projectService } from "./projects.js";

export type SpaceWorkingDirectory = { root: string; key: string; name: string };

export async function resolveSpaceWorkingDirectory(value: string): Promise<SpaceWorkingDirectory> {
  const candidate = value.trim();
  if (!candidate) throw new Error("A working directory is required");
  const resolved = path.resolve(candidate);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`Working directory does not exist: ${resolved}`);
  const root = await fs.realpath(resolved);
  return {
    root,
    key: process.platform === "win32" ? root.toLowerCase() : root,
    name: path.basename(root) || "Space",
  };
}

/** Keep one hidden compatibility project/workspace to supply the Space cwd. */
export async function provisionSpaceWorkspace(
  db: Db,
  input: { spaceId: string; name: string; root: string },
) {
  const projects = projectService(db);
  const project = await projects.create(input.spaceId, {
    name: input.name,
    description: "Internal workspace for this Space",
    status: "in_progress",
  });
  const workspace = await projects.createWorkspace(project.id, {
    name: input.name,
    cwd: input.root,
    sourceType: "local_path",
    isPrimary: true,
  });
  if (!workspace) throw new Error(`Could not create the workspace for ${input.root}`);
  return { projectId: project.id, workspaceId: workspace.id };
}

export async function writePortableSpaceManifest(input: {
  root: string;
  spaceId: string;
  name: string;
}) {
  const directory = path.join(input.root, ".outpost");
  const target = path.join(directory, "space.json");
  const temporary = `${target}.tmp-${process.pid}`;
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify({
    schemaVersion: 1,
    spaceId: input.spaceId,
    name: input.name,
  }, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
}
