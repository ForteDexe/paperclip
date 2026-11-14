import { describe, expect, it } from "vitest";
import {
  resolveArchivedSpaceBounce,
  resolveSpaceArchiveDeparture,
  shouldSyncSpaceSelectionFromRoute,
} from "./space-selection";

describe("shouldSyncSpaceSelectionFromRoute", () => {
  it("does not resync when selection already matches the route", () => {
    expect(
      shouldSyncSpaceSelectionFromRoute({
        selectionSource: "route_sync",
        selectedSpaceId: "pap",
        routeSpaceId: "pap",
      }),
    ).toBe(false);
  });

  it("defers route sync while a manual space switch is in flight", () => {
    expect(
      shouldSyncSpaceSelectionFromRoute({
        selectionSource: "manual",
        selectedSpaceId: "pap",
        routeSpaceId: "ret",
      }),
    ).toBe(false);
  });

  it("syncs back to the route space for non-manual mismatches", () => {
    expect(
      shouldSyncSpaceSelectionFromRoute({
        selectionSource: "route_sync",
        selectedSpaceId: "pap",
        routeSpaceId: "ret",
      }),
    ).toBe(true);
  });
});

describe("resolveArchivedSpaceBounce", () => {
  const archived = { id: "old", name: "Old Co", issuePrefix: "OLD", status: "archived" };
  const active = { id: "pap", name: "Outpost", issuePrefix: "PAP", status: "active" };
  const other = { id: "ret", name: "Retail", issuePrefix: "RET", status: "active" };

  it("bounces a cold arrival on an archived space's URL to the active selection", () => {
    expect(
      resolveArchivedSpaceBounce({
        matchedSpace: archived,
        selectedSpaceId: "pap",
        spaces: [archived, active, other],
      }),
    ).toEqual(active);
  });

  it("bounces to the first active space when nothing is selected", () => {
    expect(
      resolveArchivedSpaceBounce({
        matchedSpace: archived,
        selectedSpaceId: null,
        spaces: [archived, other],
      }),
    ).toEqual(other);
  });

  it("does not bounce a deliberate visit where the archived space is already selected", () => {
    expect(
      resolveArchivedSpaceBounce({
        matchedSpace: archived,
        selectedSpaceId: "old",
        spaces: [archived, active],
      }),
    ).toBeNull();
  });

  it("does not bounce active spaces or when every space is archived", () => {
    expect(
      resolveArchivedSpaceBounce({
        matchedSpace: active,
        selectedSpaceId: null,
        spaces: [archived, active],
      }),
    ).toBeNull();
    expect(
      resolveArchivedSpaceBounce({
        matchedSpace: archived,
        selectedSpaceId: null,
        spaces: [archived],
      }),
    ).toBeNull();
  });
});

describe("resolveSpaceArchiveDeparture", () => {
  const justArchived = { id: "old", name: "Old Co", issuePrefix: "OLD", status: "archived" };
  const active = { id: "pap", name: "Outpost", issuePrefix: "PAP", status: "active" };
  const alsoArchived = { id: "ret", name: "Retail", issuePrefix: "RET", status: "archived" };
  const portfolioUrl = "https://my.outpost.app/orgs?manage=1";

  it("switches to another active space when one exists, even on cloud", () => {
    expect(
      resolveSpaceArchiveDeparture({
        archivedSpaceId: "old",
        spaces: [justArchived, alsoArchived, active],
        cloudPortfolioUrl: portfolioUrl,
      }),
    ).toEqual({ kind: "space", space: active });
  });

  it("never departs into the space that was just archived, whatever its cached status", () => {
    // The caller's space list is pre-invalidation, so the archived
    // space can still read "active" there.
    expect(
      resolveSpaceArchiveDeparture({
        archivedSpaceId: "old",
        spaces: [{ ...justArchived, status: "active" }],
        cloudPortfolioUrl: null,
      }),
    ).toEqual({ kind: "spaces_list" });
  });

  it("leaves for the Cloud portfolio when no active space remains", () => {
    expect(
      resolveSpaceArchiveDeparture({
        archivedSpaceId: "old",
        spaces: [justArchived, alsoArchived],
        cloudPortfolioUrl: portfolioUrl,
      }),
    ).toEqual({ kind: "cloud_portfolio", url: portfolioUrl });
  });

  it("falls back to the spaces list on self-hosted instances", () => {
    expect(
      resolveSpaceArchiveDeparture({
        archivedSpaceId: "old",
        spaces: [justArchived],
        cloudPortfolioUrl: null,
      }),
    ).toEqual({ kind: "spaces_list" });
  });
});
