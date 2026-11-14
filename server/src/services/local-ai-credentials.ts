import { readLocalAiCredentialFile } from "./local-ai-credential-file.js";
import path from "node:path";
import { readIsolatedClaudeKeychainToken } from "@outpost/adapter-claude-local/server";
import { readCodexAuthInfo, fetchCodexQuota } from "@outpost/adapter-codex-local/server";
import type { AiProvider } from "@outpost/shared";
import { unprocessable } from "../errors.js";

export async function readVerifiedLocalAiCredentialDetails(provider: AiProvider, loginHome: string) {
  return { credential: await readVerifiedLocalAiCredential(provider, loginHome), accountLabel: undefined };
}

/** Read and verify a connection-specific login home. */
export async function readVerifiedLocalAiCredential(provider: AiProvider, loginHome?: string): Promise<string> {
  if (provider !== "openai" && provider !== "anthropic") {
    throw unprocessable("This provider is not supported.");
  }
  if (!loginHome) throw unprocessable("Start browser sign-in for this connection before connecting.");
  try {
    if (provider === "anthropic") {
      // Never change process.env or fall back to the server account when an
      // authenticated user's isolated login is missing or invalid.
      let token: string | null = null;
      for (const name of [".credentials.json", "credentials.json"]) {
        const raw = await readLocalAiCredentialFile(path.join(loginHome, name)).catch(() => null);
        if (!raw) continue;
        let parsed;
        try { parsed = JSON.parse(raw); } catch { continue; }
        const value = parsed?.claudeAiOauth?.accessToken;
        if (typeof value === "string" && value.length) { token = value; break; }
      }
      // On macOS the CLI stores the isolated login in the auth home's own
      // suffixed Keychain item rather than a credentials file. The helper
      // never consults the unsuffixed operator item.
      if (!token) token = await readIsolatedClaudeKeychainToken(loginHome);
      if (!token) throw new Error("Missing login");
      // Claude's setup-token OAuth flow requests user:inference. The usage API
      // requires user:profile and returns 403 for that valid token, so it cannot
      // serve as a sign-in check. This isolated credential is written only after
      // the provider CLI completes the code exchange successfully.
      return token;
    }
    if (provider === "openai") {
      const auth = await readCodexAuthInfo(loginHome);
      if (!auth?.accessToken || !auth.refreshToken || !auth.idToken) throw new Error("Missing login");
      await fetchCodexQuota(auth.accessToken, auth.accountId);
      return JSON.stringify({ tokens: { access_token: auth.accessToken, refresh_token: auth.refreshToken, id_token: auth.idToken, account_id: auth.accountId }, last_refresh: auth.lastRefresh });
    }
    throw new Error("Unsupported provider");
  } catch {
    // Provider/CLI errors may contain credential material; never return them.
    throw unprocessable("Could not verify the local subscription. Finish browser sign-in for this connection, then try Connect again.");
  }
}
