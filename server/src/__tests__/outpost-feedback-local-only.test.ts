import type { Db } from "@paperclipai/db";
import { describe, expect, it, vi } from "vitest";
import { feedbackService } from "../services/feedback.js";

describe("Outpost feedback policy", () => {
  it("never exposes or flushes a vendor export queue", async () => {
    const uploadTraceBundle = vi.fn();
    const databaseThatMustNotBeRead = new Proxy({}, {
      get(_target, property) {
        throw new Error(`disabled feedback export read database property ${String(property)}`);
      },
    }) as Db;
    const service = feedbackService(databaseThatMustNotBeRead, {
      shareClient: { uploadTraceBundle },
    });

    await expect(service.hasPendingFeedbackTraces()).resolves.toBe(false);
    await expect(service.flushPendingFeedbackTraces()).resolves.toEqual({ attempted: 0, sent: 0, failed: 0 });
    expect(uploadTraceBundle).not.toHaveBeenCalled();
  });
});
