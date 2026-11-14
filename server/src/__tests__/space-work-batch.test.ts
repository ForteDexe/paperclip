import { describe, expect, it } from "vitest";
import { takeSpaceWorkBatch } from "../services/space-work-batch.js";

describe("space work batch", () => {
  it("shares capacity while preserving the owner's order within each space", () => {
    const entries = [
      { spaceId: "a", id: "a-oldest" }, { spaceId: "a", id: "a-next" },
      { spaceId: "a", id: "a-later" }, { spaceId: "b", id: "b-due" },
    ];
    expect(takeSpaceWorkBatch(entries, 3)).toEqual({
      entries: [entries[0], entries[3], entries[1]], lastSpace: "a",
    });
  });
  it("rotates between batches when more spaces are due than fit in one batch", () => {
    const entries = ["a", "b", "c", "d"].flatMap(spaceId => [
      { spaceId, id: `${spaceId}-first` }, { spaceId, id: `${spaceId}-second` },
    ]);
    const first = takeSpaceWorkBatch(entries, 2);
    const remaining = entries.filter(entry => !first.entries.includes(entry));
    const second = takeSpaceWorkBatch(remaining, 2, first.lastSpace);
    expect([...first.entries, ...second.entries].map(entry => entry.spaceId)).toEqual(["a", "b", "c", "d"]);
    expect(takeSpaceWorkBatch(remaining, 1, "z").entries[0].spaceId).toBe("a");
  });
  it("finishes an empty or exhausted batch without inventing work", () => {
    expect(takeSpaceWorkBatch([], 25, "gone")).toEqual({ entries: [], lastSpace: "gone" });
    const entry = { spaceId: "only" };
    expect(takeSpaceWorkBatch([entry], 25).entries).toEqual([entry]);
  });
});
