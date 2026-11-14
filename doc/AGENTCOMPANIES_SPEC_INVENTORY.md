# Agent Companies Spec Inventory

This document indexes every part of the Outpost codebase that touches the [Agent Companies Specification](docs/companies/companies-spec.md) (`agentcompanies/v1-draft`).

Use it when you need to:

1. **Update the spec** — know which implementation code must change in lockstep.
2. **Change code that involves the spec** — find all related files quickly.
3. **Keep things aligned** — audit whether implementation matches the spec.

---

## 1. Specification & Design Documents

| File | Role |
|---|---|
| `docs/companies/companies-spec.md` | **Normative spec** — defines the markdown-first package format (COMPANY.md, TEAM.md, AGENTS.md, PROJECT.md, TASK.md, SKILL.md), reserved files, frontmatter schemas, and vendor extension conventions (`.outpost.yaml`). |
| `doc/plans/2026-03-13-space-import-export-v2.md` | Implementation plan for the markdown-first package model cutover — phases, API changes, UI plan, and rollout strategy. |
| `docs/specs/cliphub-plan.md` | Earlier blueprint bundle plan; partially superseded by the markdown-first spec (noted in the v2 plan). |
| `doc/plans/2026-02-16-module-system.md` | Module system plan; JSON-only space template sections superseded by the markdown-first model. |
| `doc/plans/2026-03-14-skills-ui-product-plan.md` | Skills UI plan; references portable skill files and `.outpost.yaml`. |
| `doc/plans/2026-03-14-adapter-skill-sync-rollout.md` | Adapter skill sync rollout; companion to the v2 import/export plan. |

## 2. Shared Types & Validators

These define the contract between server, CLI, and UI.

| File | What it defines |
|---|---|
| `packages/shared/src/types/space-portability.ts` | TypeScript interfaces: `SpacePortabilityManifest`, `SpacePortabilityFileEntry`, `SpacePortabilityEnvInput`, export/import/preview request and result types, manifest entry types for agents, skills, projects, issues, recurring routines, spaces. |
| `packages/shared/src/validators/space-portability.ts` | Zod schemas for all portability request/response shapes — used by both server routes and CLI. |
| `packages/shared/src/types/index.ts` | Re-exports portability types. |
| `packages/shared/src/validators/index.ts` | Re-exports portability validators. |

## 3. Server — Services

| File | Responsibility |
|---|---|
| `server/src/services/space-portability.ts` | **Core portability service.** Export (manifest generation, markdown file emission, `.outpost.yaml` sidecars), import (graph resolution, collision handling, entity creation), preview (planned-action summary). Handles skill key derivation, recurring task <-> routine mapping, legacy recurrence migration, and package README generation. References `agentcompanies/v1` version string. |
| `server/src/services/routines.ts` | Outpost routine runtime service. Portability now exports routines as recurring `TASK.md` entries and imports recurring tasks back through this service. |
| `server/src/services/space-export-readme.ts` | Generates `README.md` and Mermaid org-chart for exported company packages. |
| `server/src/services/index.ts` | Re-exports `spacePortabilityService`. |

## 4. Server — Routes

| File | Endpoints |
|---|---|
| `server/src/routes/spaces.ts` | `POST /api/spaces/:spaceId/export` — legacy export bundle<br>`POST /api/spaces/:spaceId/exports/preview` — export preview<br>`POST /api/spaces/:spaceId/exports` — export package<br>`POST /api/spaces/import/preview` — import preview<br>`POST /api/spaces/import` — perform import |

Route registration lives in `server/src/app.ts` via `spaceRoutes(db, storage)`.

## 5. Server — Tests

| File | Coverage |
|---|---|
| `server/src/__tests__/space-portability.test.ts` | Unit tests for the portability service (export, import, preview, manifest shape, `agentcompanies/v1` version). |
| `server/src/__tests__/space-portability-routes.test.ts` | Integration tests for the portability HTTP endpoints. |

## 6. CLI

| File | Commands |
|---|---|
| `cli/src/commands/client/space.ts` | `space export` — exports a company package to disk (flags: `--out`, `--include`, `--projects`, `--issues`, `--projectIssues`).<br>`space import <fromPathOrUrl>` — imports a company package from a file or folder (flags: positional source path/URL or GitHub shorthand, `--include`, `--target`, `--spaceId`, `--newSpaceName`, `--agents`, `--collision`, `--ref`, `--dryRun`).<br>Reads/writes portable file entries and handles `.outpost.yaml` filtering. |

## 7. UI — Pages

| File | Role |
|---|---|
| `ui/src/pages/SpaceExport.tsx` | Export UI: preview, manifest display, file tree visualization, ZIP archive creation and download. Filters `.outpost.yaml` based on selection. Shows manifest and README in editor. |
| `ui/src/pages/SpaceImport.tsx` | Import UI: source input (upload/folder/GitHub URL/generic URL), ZIP reading, preview pane with dependency tree, entity selection checkboxes, trust/licensing warnings, secrets requirements, collision strategy, adapter config. |

## 8. UI — Components

| File | Role |
|---|---|
| `ui/src/components/PackageFileTree.tsx` | Reusable file tree component for both import and export. Builds tree from `SpacePortabilityFileEntry` items, parses frontmatter, shows action indicators (create/update/skip), and maps frontmatter field labels. |

## 9. UI — Libraries

| File | Role |
|---|---|
| `ui/src/lib/portable-files.ts` | Helpers for portable file entries: `getPortableFileText`, `getPortableFileDataUrl`, `getPortableFileContentType`, `isPortableImageFile`. |
| `ui/src/lib/zip.ts` | ZIP archive creation (`createZipArchive`) and reading (`readZipArchive`) — implements ZIP format from scratch for company packages. CRC32, DOS date/time encoding. |
| `ui/src/lib/zip.test.ts` | Tests for ZIP utilities; exercises round-trip with portability file entries and `.outpost.yaml` content. |

## 10. UI — API Client

| File | Functions |
|---|---|
| `ui/src/api/spaces.ts` | `spacesApi.exportBundle`, `spacesApi.exportPreview`, `spacesApi.exportPackage`, `spacesApi.importPreview`, `spacesApi.importBundle` — typed fetch wrappers for the portability endpoints. |

## 11. Skills & Agent Instructions

| File | Relevance |
|---|---|
| `skills/outpost/references/space-skills.md` | Reference doc for space skill library workflow — install, inspect, update, assign. Skill packages are a subset of the agent spaces spec. |
| `server/src/services/space-skills.ts` | Space skill management service — handles SKILL.md-based imports and space-level skill library. |
| `server/src/services/agent-instructions.ts` | Agent instructions service — resolves AGENTS.md paths for agent instruction loading. |

## 12. Quick Cross-Reference by Spec Concept

| Spec concept | Primary implementation files |
|---|---|
| `COMPANY.md` frontmatter & body | `space-portability.ts` (export emitter + import parser) |
| `AGENTS.md` frontmatter & body | `space-portability.ts`, `agent-instructions.ts` |
| `PROJECT.md` frontmatter & body | `space-portability.ts` |
| `TASK.md` frontmatter & body | `space-portability.ts` |
| `SKILL.md` packages | `space-portability.ts`, `space-skills.ts` |
| `.outpost.yaml` vendor sidecar | `space-portability.ts`, `routines.ts`, `SpaceExport.tsx`, `space.ts` (CLI) |
| `manifest.json` | `space-portability.ts` (generation), shared types (schema) |
| ZIP package format | `zip.ts` (UI), `space.ts` (CLI file I/O) |
| Collision resolution | `space-portability.ts` (server), `SpaceImport.tsx` (UI) |
| Env/secrets declarations | shared types (`SpacePortabilityEnvInput`), `SpaceImport.tsx` (UI) |
| README + org chart | `space-export-readme.ts` |
