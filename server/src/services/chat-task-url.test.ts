import { afterEach, describe, expect, it, vi } from "vitest";
import { readConfigFile } from "../config-file.js";
import { publicChatTaskUrl, safeChatTaskUrl } from "./chat-task-url.js";
import { safeMilestoneText } from "./chat-run-publications.js";
import { runtimeCanonicalOrigin } from "./cloud-runtime-identity.js";
import { publicChatInteractionTaskUrl } from "./chat-interaction-publications.js";

vi.mock("../config-file.js", () => ({
  readConfigFile: vi.fn(() => null),
}));

vi.mock("./cloud-runtime-identity.js", () => ({
  runtimeCanonicalOrigin: vi.fn(() => null),
}));

afterEach(() => {
  vi.mocked(runtimeCanonicalOrigin).mockReturnValue(null);
  vi.unstubAllEnvs();
  vi.mocked(readConfigFile).mockReturnValue(null);
});

describe("external Outpost task links", () => {
  it("resolves a newly claimed Cloud origin at use time ahead of pool configuration", () => {
    vi.stubEnv("OUTPOST_AUTH_PUBLIC_BASE_URL", "https://pool.example");
    expect(publicChatTaskUrl("issue-1")).toBe("https://pool.example/issues/issue-1");
    vi.mocked(runtimeCanonicalOrigin).mockReturnValue("https://vanity.example");
    expect(publicChatTaskUrl("issue-1")).toBe("https://vanity.example/issues/issue-1");
    expect(publicChatInteractionTaskUrl("issue-1")).toBe("https://vanity.example/issues/issue-1");
  });

  it("uses only the safe operator origin and canonical issue path", () => {
    expect(
      safeChatTaskUrl(
        "https://operator.example/path?secret=ignored#fragment",
        "issue-1",
      ),
    ).toBe("https://operator.example/issues/issue-1");
    expect(safeChatTaskUrl("https://operator.example", "a/b?c")).toBe(
      "https://operator.example/issues/a%2Fb%3Fc",
    );
  });

  it.each([
    undefined,
    null,
    "",
    "not a URL",
    "http://operator.example",
    "http://127.0.0.1:3103",
    "https://localhost",
    "https://10.0.0.1",
    "https://operator.internal",
    "https://user:secret@operator.example",
  ])(
    "omits unsafe or private operator links before generating recovery copy (%s)",
    (baseUrl) => {
      expect(safeChatTaskUrl(baseUrl, "issue-1")).toBeNull();
      expect(
        safeMilestoneText({
          agentName: "Maya",
          milestone: "failed",
          issueId: "issue-1",
          publicBaseUrl: baseUrl,
        }),
      ).toBe(
        "Maya stopped before completing this turn. Open the task in Outpost for details.",
      );
    },
  );

  it("does not use webhook ingress as the question or confirmation destination", () => {
    for (const name of [
      "OUTPOST_PUBLIC_URL",
      "OUTPOST_AUTH_PUBLIC_BASE_URL",
      "BETTER_AUTH_URL",
      "BETTER_AUTH_BASE_URL",
      "OUTPOST_MANAGED_RUNTIME_PUBLIC_URL",
    ])
      vi.stubEnv(name, "");
    vi.stubEnv("OUTPOST_CHAT_WEBHOOK_PUBLIC_URL", "https://ingress.example");
    expect(publicChatInteractionTaskUrl("issue-1")).toBeNull();
    vi.stubEnv("OUTPOST_PUBLIC_URL", "http://127.0.0.1:3103");
    expect(publicChatInteractionTaskUrl("issue-1")).toBeNull();
    vi.stubEnv("OUTPOST_PUBLIC_URL", "https://operator.example");
    expect(publicChatInteractionTaskUrl("issue-1")).toBe(
      "https://operator.example/issues/issue-1",
    );
    vi.stubEnv("OUTPOST_AUTH_PUBLIC_BASE_URL", "https://canonical.example");
    expect(publicChatInteractionTaskUrl("issue-1")).toBe(
      "https://canonical.example/issues/issue-1",
    );
  });

  it("uses the configured operator origin ahead of the managed-runtime fallback", () => {
    for (const name of [
      "OUTPOST_PUBLIC_URL",
      "OUTPOST_AUTH_PUBLIC_BASE_URL",
      "BETTER_AUTH_URL",
      "BETTER_AUTH_BASE_URL",
    ])
      vi.stubEnv(name, "");
    vi.stubEnv(
      "OUTPOST_MANAGED_RUNTIME_PUBLIC_URL",
      "https://managed.example",
    );
    vi.mocked(readConfigFile).mockReturnValue({
      auth: { publicBaseUrl: "https://configured.example" },
    } as ReturnType<typeof readConfigFile>);

    expect(publicChatInteractionTaskUrl("issue-1")).toBe(
      "https://configured.example/issues/issue-1",
    );

    vi.stubEnv("OUTPOST_PUBLIC_URL", "https://environment.example");
    expect(publicChatInteractionTaskUrl("issue-1")).toBe(
      "https://environment.example/issues/issue-1",
    );
  });
});
