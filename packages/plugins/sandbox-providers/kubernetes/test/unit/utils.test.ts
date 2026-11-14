import { describe, it, expect } from "vitest";
import { deriveSpaceSlug, deriveNamespaceName, newRunUlidDns, outpostLabels } from "../../src/utils.js";

describe("deriveSpaceSlug", () => {
  it("lowercases and replaces non-alphanumerics", () => {
    expect(deriveSpaceSlug("Acme Co!")).toBe("acme-co");
  });

  it("preserves long inputs within the namespace budget instead of blind truncation", () => {
    const input = "a".repeat(40) + "-suffix-that-pushes-past-the-budget";
    const slug = deriveSpaceSlug(input);
    expect(slug.length).toBeLessThanOrEqual(53);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("falls back to 'space' on empty/zero-letter input", () => {
    expect(deriveSpaceSlug("!!!")).toBe("space");
    expect(deriveSpaceSlug("")).toBe("space");
  });
  it("keeps full UUIDs untruncated so distinct spaces never share a slug", () => {
    const a = deriveSpaceSlug("0d9c52f6-2f30-4d3e-9a01-aaaaaaaa0001");
    const b = deriveSpaceSlug("0d9c52f6-2f30-4d3e-9a01-aaaaaaaa0002");
    expect(a).toBe("0d9c52f6-2f30-4d3e-9a01-aaaaaaaa0001");
    expect(a).not.toBe(b);
  });

  it("appends a hash of the full input when the slug exceeds the namespace budget", () => {
    const long1 = "x".repeat(60) + "-tail-one";
    const long2 = "x".repeat(60) + "-tail-two";
    const s1 = deriveSpaceSlug(long1);
    const s2 = deriveSpaceSlug(long2);
    expect(s1.length).toBeLessThanOrEqual(53);
    expect(s2.length).toBeLessThanOrEqual(53);
    expect(s1).not.toBe(s2);
  });
});

describe("deriveNamespaceName", () => {
  it("concatenates prefix and slug", () => {
    expect(deriveNamespaceName("outpost-", "acme-co")).toBe("outpost-acme-co");
  });
});

describe("newRunUlidDns", () => {
  it("produces a DNS-safe 26-char lowercase id", () => {
    const id = newRunUlidDns();
    expect(id).toMatch(/^[a-z0-9]{26}$/);
  });
});

describe("outpostLabels", () => {
  it("returns canonical label map", () => {
    const labels = outpostLabels({ runId: "r1", agentId: "a1", spaceId: "c1", adapterType: "claude_local" });
    expect(labels["outpost.io/run-id"]).toBe("r1");
    expect(labels["outpost.io/agent-id"]).toBe("a1");
    expect(labels["outpost.io/space-id"]).toBe("c1");
    expect(labels["outpost.io/adapter"]).toBe("claude_local");
    expect(labels["outpost.io/managed-by"]).toBe("outpost-k8s-plugin");
  });
});
