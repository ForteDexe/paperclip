import { createRoot, type Root } from "react-dom/client";

export interface OutpostReactRootHost {
  __outpostReactRoot?: Root;
}

type CreateRoot = (container: Parameters<typeof createRoot>[0]) => Root;

/**
 * Keep one React root per browser window even if Vite evaluates the entry
 * module more than once during a development reload.
 */
export function getOrCreateOutpostReactRoot(
  host: object,
  container: Parameters<typeof createRoot>[0],
  create: CreateRoot = createRoot,
): Root {
  const rootHost = host as OutpostReactRootHost;
  if (rootHost.__outpostReactRoot) return rootHost.__outpostReactRoot;

  const root = create(container);
  rootHost.__outpostReactRoot = root;
  return root;
}
