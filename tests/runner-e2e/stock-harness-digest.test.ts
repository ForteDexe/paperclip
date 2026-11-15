import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { sourceFingerprint } from "./stock-harness-checks.mjs";
import { stockHarnessSourceDigest, stockHarnessSkillSources } from "./stock-harness.js";

vi.mock("node:fs", async importOriginal => ({ ...await importOriginal<typeof import("node:fs")>(), readFileSync: vi.fn() }));
const matchesSource = (file: unknown, source: string) => String(file).replaceAll("\\", "/").endsWith(source);

describe("stock harness instruction revision", () => {
  it("invalidates the prerequisite fingerprint when checkout observation changes", () => {
    vi.mocked(readFileSync).mockImplementation(() => Buffer.from("unchanged"));
    const original = sourceFingerprint();
    vi.mocked(readFileSync).mockImplementation(file => Buffer.from(
      matchesSource(file, "tests/runner-e2e/checkout-activity.ts") ? "changed accounting" : "unchanged"));
    const changed = sourceFingerprint();
    expect(original.sourceErrors).toEqual([]);
    expect(changed.sourceErrors).toEqual([]);
    expect(changed.fingerprint).not.toBe(original.fingerprint);
  });

  it.each(["scripts/outpost-issue-update.sh", "skills/outpost-task/scripts/outpost-task-update.sh", "tests/runner-e2e/checkout-activity.ts", "server/src/onboarding-assets/default/AGENTS.md", "packages/adapter-utils/src/server-utils.ts", "packages/shared/src/connection-intent-guidance.ts", "skills/outpost-task/SKILL.md", "skills/outpost-task/references/task-documents.md", "packages/outpost-runner/generated/capability/capabilities.yaml", "packages/outpost-runner/spec/capability/capabilities.yaml", "tests/runner-e2e/stock-harness-manifest.ts", "packages/adapter-utils/src/acpx-engine/execute.ts", "packages/adapter-utils/src/acpx-engine/ephemeral-session-environment.ts", "tests/runner-e2e/stock-harness-instruction-variant.mjs", "tests/runner-e2e/automatic-retry.ts", "tests/runner-e2e/catalog.ts"])(
    "changes when the evaluated %s changes", source => {
      vi.mocked(readFileSync).mockImplementation(() => Buffer.from("unchanged"));
      const original = stockHarnessSourceDigest();
      vi.mocked(readFileSync).mockImplementation(file => Buffer.from(matchesSource(file, source) ? "changed instructions" : "unchanged"));
      expect(stockHarnessSourceDigest()).not.toBe(original);
    });
  it.each(["scripts/outpost-issue-update.sh", "skills/outpost-task/scripts/outpost-task-update.sh"])(
    "invalidates the prerequisite fingerprint when %s changes", source => {
      vi.mocked(readFileSync).mockImplementation(() => Buffer.from("unchanged"));
      const original = sourceFingerprint();
      vi.mocked(readFileSync).mockImplementation(file => Buffer.from(
        matchesSource(file, source) ? "changed helper" : "unchanged"));
      expect(sourceFingerprint().fingerprint).not.toBe(original.fingerprint);
    });
  it("rejects a missing or unreadable bundled helper", () => {
    vi.mocked(readFileSync).mockImplementation(() => Buffer.from("unchanged"));
    const original = sourceFingerprint();
    vi.mocked(readFileSync).mockImplementation(file => {
      if (matchesSource(file, "skills/outpost-task/scripts/outpost-task-update.sh"))
        throw Object.assign(new Error("absent"), { code: "ENOENT" });
      return Buffer.from("unchanged");
    });
    expect(sourceFingerprint().sourceErrors).toContain("skills/outpost-task/scripts/outpost-task-update.sh");
    expect(sourceFingerprint().fingerprint).not.toBe(original.fingerprint);
    expect(stockHarnessSourceDigest).toThrow("absent");
    vi.mocked(readFileSync).mockImplementation(() => { throw Object.assign(new Error("unreadable"), { code: "EACCES" }); });
    expect(stockHarnessSourceDigest).toThrow("unreadable");
    expect(sourceFingerprint().sourceErrors).toContain("skills/outpost-task/scripts/outpost-task-update.sh");
  });
  it("rejects an absent or unreadable task-document recipe", () => {
    vi.mocked(readFileSync).mockImplementation(() => Buffer.from("unchanged"));
    vi.mocked(readFileSync).mockImplementation(file => {
      if (matchesSource(file, "skills/outpost-task/references/task-documents.md")) throw Object.assign(new Error("absent"), { code: "ENOENT" });
      return Buffer.from("unchanged");
    });
    expect(stockHarnessSkillSources).toThrow("absent");
    vi.mocked(readFileSync).mockImplementation(() => { throw Object.assign(new Error("unreadable"), { code: "EACCES" }); });
    expect(stockHarnessSourceDigest).toThrow("unreadable");
  });
});
