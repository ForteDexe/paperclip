import type {
  CreateFolderRequest,
  EnsureMySkillFolderRequest,
  Folder,
  FolderKind,
  FolderListResult,
  MoveFolderItemRequest,
  MoveFolderRequest,
  UpdateFolderRequest,
} from "@outpost/shared";
import { api } from "./client";

export const foldersApi = {
  list: (spaceId: string, kind: FolderKind) =>
    api.get<FolderListResult>(`/spaces/${encodeURIComponent(spaceId)}/folders?kind=${kind}`),
  create: (spaceId: string, payload: CreateFolderRequest) =>
    api.post<Folder>(`/spaces/${encodeURIComponent(spaceId)}/folders`, payload),
  ensureMy: (spaceId: string, payload: EnsureMySkillFolderRequest = {}) =>
    api.post<Folder>(`/spaces/${encodeURIComponent(spaceId)}/folders/ensure-my`, payload),
  update: (spaceId: string, folderId: string, payload: UpdateFolderRequest) =>
    api.patch<Folder>(
      `/spaces/${encodeURIComponent(spaceId)}/folders/${encodeURIComponent(folderId)}`,
      payload,
    ),
  moveFolder: (spaceId: string, folderId: string, payload: MoveFolderRequest) =>
    api.post<Folder>(
      `/spaces/${encodeURIComponent(spaceId)}/folders/${encodeURIComponent(folderId)}/move`,
      payload,
    ),
  moveItem: (spaceId: string, payload: MoveFolderItemRequest) =>
    api.post<MoveFolderItemRequest>(
      `/spaces/${encodeURIComponent(spaceId)}/folders/items/move`,
      payload,
    ),
  delete: (spaceId: string, folderId: string) =>
    api.delete<{ deleted: Folder }>(
      `/spaces/${encodeURIComponent(spaceId)}/folders/${encodeURIComponent(folderId)}`,
    ),
};
