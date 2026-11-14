import type { PaperclipPluginManifestV1 } from "@outpost/plugin-sdk";

export const PLUGIN_ID = "forted.campfire";
export const STREAM_CHANNEL = "campfire:rooms";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Campfire",
  description: "Persistent rooms where people and Outpost agents coordinate development work.",
  author: "ForteD",
  categories: ["automation", "ui"],
  capabilities: [
    "database.namespace.migrate",
    "database.namespace.read",
    "database.namespace.write",
    "agents.read",
    "projects.read",
    "agent.sessions.create",
    "agent.sessions.list",
    "agent.sessions.send",
    "agent.sessions.close",
    "ui.sidebar.register",
    "ui.page.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  database: {
    namespaceSlug: "campfire",
    migrationsDir: "migrations",
    coreReadTables: ["companies", "agents", "projects"],
  },
  ui: {
    slots: [
      {
        type: "sidebar",
        id: "campfire-sidebar",
        displayName: "Campfire",
        exportName: "CampfireSidebarLink",
        order: 30,
      },
      {
        type: "page",
        id: "campfire-page",
        displayName: "Campfire",
        exportName: "CampfirePage",
        routePath: "campfire",
      },
    ],
  },
};

export default manifest;
