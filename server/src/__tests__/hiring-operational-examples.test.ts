import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const skill = readFileSync(new URL("../../../skills/paperclip/SKILL.md", import.meta.url), "utf8");
const reference = readFileSync(
  new URL("../../../skills/paperclip/references/api-reference.md", import.meta.url),
  "utf8",
);

describe("Outpost task-runtime skill", () => {
  it("keeps the agent focused on one durable task owner", () => {
    expect(skill.replace(/\s+/g, " ")).toContain("the task remains owned by that agent from start to finish");
    expect(skill).toContain("Campfire discussion does not change task ownership");
    expect(skill).toContain("unless the user explicitly requests");
  });

  it("omits the former corporate operating model", () => {
    for (const body of [skill, reference]) {
      expect(body).not.toMatch(/\bCEO\b|\bCTO\b|\bboard\b|\broutines?\b/i);
      expect(body).not.toContain("agent-hires");
      expect(body).not.toContain("imports/preview");
      expect(body).not.toContain("exports/preview");
    }
  });

  it("retains the task operations needed by a scope owner", () => {
    expect(reference).toContain("/api/issues/:taskId/checkout");
    expect(reference).toContain("/api/issues/:taskId/comments");
    expect(reference).toContain("/api/issues/:taskId/documents/:key");
    expect(reference).toContain("/api/issues/:taskId/interactions");
    expect(reference).toContain("/api/issues/:taskId/work-products");
  });
});
