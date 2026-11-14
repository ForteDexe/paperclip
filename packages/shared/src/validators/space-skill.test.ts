import { describe, expect, it } from "vitest";
import {
  spaceSkillAuditResultSchema,
  spaceSkillInstallUpdateSchema,
  spaceSkillUpdateStatusSchema,
} from "./space-skill.js";

describe("space skill update validators", () => {
  it("accepts update status, audit, and update contract shapes", () => {
    expect(spaceSkillUpdateStatusSchema.parse({
      supported: true,
      reason: null,
      trackingRef: "main",
      currentRef: "sha256:old",
      latestRef: "sha256:new",
      hasUpdate: true,
      installedHash: "sha256:installed",
      originHash: "sha256:origin",
      userModifiedAt: "2026-05-26T00:00:00.000Z",
      updateHoldReason: "local_modifications",
      auditVerdict: "warning",
      auditCodes: ["local_modifications"],
    })).toMatchObject({
      supported: true,
      updateHoldReason: "local_modifications",
      auditVerdict: "warning",
    });

    expect(spaceSkillAuditResultSchema.parse({
      skillId: "00000000-0000-4000-8000-000000000001",
      installedHash: "sha256:installed",
      originHash: "sha256:origin",
      verdict: "fail",
      codes: ["remote_fetch_exec"],
      findings: [{
        code: "remote_fetch_exec",
        severity: "error",
        message: "Remote-fetch or dynamic execution pattern is not allowed.",
        path: "SKILL.md",
      }],
      scannedAt: "2026-05-26T00:00:00.000Z",
      scanVersion: "skills-audit-v1",
    })).toMatchObject({
      verdict: "fail",
      codes: ["remote_fetch_exec"],
    });

    expect(spaceSkillInstallUpdateSchema.parse(undefined)).toEqual({});
    expect(spaceSkillInstallUpdateSchema.parse({ force: true })).toEqual({ force: true });
  });
});
