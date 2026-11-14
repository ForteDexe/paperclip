import {
  extractSpacePrefixFromPath,
  normalizeSpacePrefix,
  toSpaceRelativePath,
} from "./space-routes";

const GLOBAL_SEGMENTS = new Set(["auth", "invite", "operator-claim", "cli-auth", "docs"]);

export function isRememberableSpacePath(path: string): boolean {
  const pathname = path.split("?")[0] ?? "";
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return true;
  const [root] = segments;
  if (GLOBAL_SEGMENTS.has(root!)) return false;
  return true;
}

function findSpaceByPrefix<T extends { id: string; issuePrefix: string }>(params: {
  spaces: T[];
  spacePrefix: string;
}): T | null {
  const normalizedPrefix = normalizeSpacePrefix(params.spacePrefix);
  return params.spaces.find((space) => normalizeSpacePrefix(space.issuePrefix) === normalizedPrefix) ?? null;
}

export function getRememberedPathOwnerSpaceId<T extends { id: string; issuePrefix: string }>(params: {
  spaces: T[];
  pathname: string;
  fallbackSpaceId: string | null;
}): string | null {
  const routeSpacePrefix = extractSpacePrefixFromPath(params.pathname);
  if (!routeSpacePrefix) {
    return params.fallbackSpaceId;
  }

  return findSpaceByPrefix({
    spaces: params.spaces,
    spacePrefix: routeSpacePrefix,
  })?.id ?? null;
}

export function sanitizeRememberedPathForSpace(params: {
  path: string | null | undefined;
  spacePrefix: string;
}): string {
  const relativePath = params.path ? toSpaceRelativePath(params.path) : "/dashboard";
  if (!isRememberableSpacePath(relativePath)) {
    return "/dashboard";
  }

  const pathname = relativePath.split("?")[0] ?? "";
  const segments = pathname.split("/").filter(Boolean);
  const [root, entityId] = segments;
  if (root === "issues" && entityId) {
    const identifierMatch = /^([A-Za-z]+)-\d+$/.exec(entityId);
    if (
      identifierMatch &&
      normalizeSpacePrefix(identifierMatch[1] ?? "") !== normalizeSpacePrefix(params.spacePrefix)
    ) {
      return "/dashboard";
    }
  }

  return relativePath;
}
