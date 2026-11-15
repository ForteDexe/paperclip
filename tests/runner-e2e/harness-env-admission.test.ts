import { afterEach, expect, it, vi } from "vitest";
import { runnerMatrix } from "./catalog.js";
import { QUALIFIED_ACPX_PROFILES } from "../../packages/outpost-runner/src/drivers/acpx/qualified-profiles.js";

const profilesModule = "../../packages/outpost-runner/src/drivers/acpx/qualified-profiles.js";
const copilot = runnerMatrix.find(cell => cell.suite.id === "extended-harnesses" && cell.profile.qualificationCandidate === "copilot")!;
afterEach(() => { vi.doUnmock(profilesModule); vi.resetModules(); });

it("uses normal production admission for the current qualified Copilot profile", async () => {
  expect(QUALIFIED_ACPX_PROFILES.copilot.qualificationStatus).toBeUndefined();
  const { buildRunnerE2EProcessEnvironment } = await import("./harness-env.js");
  expect(buildRunnerE2EProcessEnvironment({ OUTPOST_RUNNER_ACPX_QUALIFICATION: "ambient" }, [copilot])
    .OUTPOST_RUNNER_ACPX_QUALIFICATION).toBeUndefined();
});

it("retains exact, explicit admission when a future profile is pending", async () => {
  const actual = await vi.importActual<typeof import("../../packages/outpost-runner/src/drivers/acpx/qualified-profiles.js")>(profilesModule);
  vi.doMock(profilesModule, () => ({ ...actual, QUALIFIED_ACPX_PROFILES: { ...actual.QUALIFIED_ACPX_PROFILES,
    copilot: { ...actual.QUALIFIED_ACPX_PROFILES.copilot, qualificationStatus: "pending" } } }));
  vi.resetModules();
  const { buildRunnerE2EProcessEnvironment } = await import("./harness-env.js");
  const env = buildRunnerE2EProcessEnvironment({ OUTPOST_RUNNER_ACPX_QUALIFICATION: "ambient" }, [copilot]);
  expect(JSON.parse(env.OUTPOST_RUNNER_ACPX_QUALIFICATION!)).toEqual([{ agent: "copilot", model: copilot.profile.model }]);
  expect(() => buildRunnerE2EProcessEnvironment({}, [{ ...copilot, suite: { ...copilot.suite, manualOnly: false } }])).toThrow("explicit");
  expect(() => buildRunnerE2EProcessEnvironment({}, [{ ...copilot, suite: { ...copilot.suite, id: "unrelated-suite" } }])).toThrow("explicit");
  expect(() => buildRunnerE2EProcessEnvironment({}, [copilot, { ...copilot, profile: { ...copilot.profile, model: "conflicting-model" } }])).toThrow("Conflicting");
});

it("strips ambient candidate startup records without an explicit candidate selection", async () => {
  const { buildRunnerE2EProcessEnvironment, buildOutpostServerEnvironment } = await import("./harness-env.js");
  const ambient = { OUTPOST_ACPX_CANDIDATE_ADMISSION: "forged", OUTPOST_RUNNER_ACPX_QUALIFICATION: "forged" };
  const env = buildRunnerE2EProcessEnvironment(ambient, []);
  expect(env.OUTPOST_ACPX_CANDIDATE_ADMISSION).toBeUndefined();
  expect(env.OUTPOST_RUNNER_ACPX_QUALIFICATION).toBeUndefined();
  expect(buildOutpostServerEnvironment(ambient).OUTPOST_ACPX_CANDIDATE_ADMISSION).toBeUndefined();
});
