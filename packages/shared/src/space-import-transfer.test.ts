import { describe, expect, it } from "vitest";
import { buildAlreadyImportedMessage } from "./space-import-transfer.js";

describe("buildAlreadyImportedMessage", () => {
  it("names the landed space with its prefix", () => {
    expect(
      buildAlreadyImportedMessage({ id: "space-2", name: "Outpost", issuePrefix: "PAPA" }),
    ).toBe(
      'This exact package was already imported by a completed transfer. The earlier import landed in the space "Outpost" (PAPA) — open it from the space switcher. Re-export the package to import it again.',
    );
  });

  it("falls back to the space id when the name is gone and omits an absent prefix", () => {
    expect(
      buildAlreadyImportedMessage({ id: "space-2", name: null, issuePrefix: null }),
    ).toBe(
      'This exact package was already imported by a completed transfer. The earlier import landed in the space "space-2" — open it from the space switcher. Re-export the package to import it again.',
    );
  });

  it("keeps the original message when no space is known", () => {
    expect(buildAlreadyImportedMessage(null)).toBe(
      "This exact package was already imported by a completed transfer. Re-export the package to import it again.",
    );
    expect(buildAlreadyImportedMessage(undefined)).toBe(
      "This exact package was already imported by a completed transfer. Re-export the package to import it again.",
    );
  });
});
