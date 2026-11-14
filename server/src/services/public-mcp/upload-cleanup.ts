import type { StorageService } from "../../storage/types.js";

type AttachmentStorage = {
  id: string;
  spaceId: string;
  issueId: string;
  provider: string;
  objectKey: string;
};

export type McpAttachmentCleanup = AttachmentStorage & { verifiedAt: Date };

export async function confirmMcpAttachmentCleanup(
  _db: unknown,
  _storage: StorageService,
  _attachment: AttachmentStorage,
): Promise<null> {
  return null;
}

export async function recordMcpAttachmentCleanup(..._args: unknown[]): Promise<void> {}
