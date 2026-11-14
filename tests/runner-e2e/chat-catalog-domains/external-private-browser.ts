import {canonicalSpaceSecretKey,validSpaceSecretMetadata} from "./external-space-secret-confirmation.js";
import { validDevicePrivateInput, matchesDevicePrivateReceipt, type DevicePrivateInput } from "./external-device-private-contract.js";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium, type Cookie } from "@playwright/test";
import type { GrokRoutinePrivateInput } from "./external-grok-private-contract.js";
import type { SlackIdentityPrivateInput } from "./external-slack-identity-contract.js";
import type { SlackSetupPrivateInput } from "./external-slack-setup-private-contract.js";
export interface PrivateBrowserReceipt { processIsolation: true; testRunnerAttached: false; tracingEnabled: false; videoEnabled: false; apiStepRecorder: false; credentialEntered?: boolean; connectionId?: string; challengeVisible?: boolean; passwordInput?: boolean; autocompleteOff?: boolean; humanSubmittedSecurely?: boolean; visibleReady?: boolean; storageClean?: boolean; newTokenId?: string; tokenUiVisible?: boolean; newWorkedBeforeRevocation?: boolean; oldWorkedUntilRevocation?: boolean; revealedPending?: boolean; oldRevoked?: boolean; newWorksAfter?: boolean; oldStatusAfter?: number; otherWorksAfter?: boolean; secretId?:string; requestedSpaceName?:string; requestedSpaceKey?:string; savedSpaceName?:string; savedSpaceKey?:string; secretUiVisible?:boolean; bindingId?:string; routineConfigured?:boolean; routineUiVisible?:boolean; identityConfirmed?:boolean; identityUiVisible?:boolean; principalId?:string; outpostUserId?:string; endpointId?:string; slackCredentialUiVisible?:boolean; activationUiVisible?:boolean; endpointActive?:boolean; identityWasAlreadyLinked?:boolean; credentialUiRejected?:boolean; deviceSessionVerified?:boolean; currentCodeVisible?:boolean; spaceConsentVisible?:boolean; readScopeVisible?:boolean; humanApproved?:boolean; expiredPageVisible?:boolean }
export async function privateBrowserEntry(input: { mode: "secure-key" | "canary" | "gateway-token-rotation" | "space-secret-create" | "personal-secret-create" | "grok-routine-configure" | "slack-identity-confirm" | "slack-endpoint-configure" | "slack-wizard-confirm" | "slack-wizard-resume" | "slack-endpoint-reconnect" | "device-approve" | "device-expired"; device?: DevicePrivateInput; slackSetup?:SlackSetupPrivateInput; slackIdentity?:SlackIdentityPrivateInput; grok?:GrokRoutinePrivateInput; spaceId?:string; spaceMetadata?:{name?:string;key?:string}; personal?:{definitionId:string;userId:string;viaMySecrets?:boolean}; gateway?: { id: string; oldTokenId: string; otherToken: string; endpointPath: string; readName: string; pendingTokenId?: string }; baseURL: string; setupURL: string; providerURL: string; credential: string; cookies: Cookie[] }, onToken?: (token: { id: string; token: string }) => void) {
  if(input.spaceMetadata!==undefined&&(input.mode!=="space-secret-create"||!validSpaceSecretMetadata(input.spaceMetadata)))throw new Error("Invalid space metadata request");
  if (input.mode.startsWith("device-") && !validDevicePrivateInput(input.mode, input.baseURL, input.setupURL, input.spaceId, input.device, input.credential)) throw new Error("Invalid finite private device UI operation");
  const directory = await mkdtemp(path.join(tmpdir(), "outpost-private-browser-"));
  try {
    const request = path.join(directory, "request.json");
    const channel = process.env.OUTPOST_PLAYWRIGHT_CHANNEL;
    await writeFile(request, JSON.stringify({ ...input, executablePath: process.env.OUTPOST_RUNNER_E2E_CHROMIUM_EXECUTABLE ?? (channel ? undefined : chromium.executablePath()), channel }), { mode: 0o600 });
    const worker = fileURLToPath(new URL("./external-private-browser-worker.ts", import.meta.url));
    const loader = fileURLToPath(new URL("../../../server/node_modules/tsx/dist/loader.mjs", import.meta.url));
    let output: string;
    try {
      const result = await promisify(execFile)(process.execPath, ["--import", loader, worker, request], { timeout: 120_000, maxBuffer: 16_384,
        env: { PATH: process.env.PATH ?? "", NODE_ENV: "test", DO_NOT_TRACK: "1", HOME: directory, TMPDIR: directory } }); output = result.stdout;
    } catch { throw new Error("Private browser entry failed; child output and credential-bearing request withheld"); }
    let receipt: PrivateBrowserReceipt; try { receipt = JSON.parse(output) as PrivateBrowserReceipt; } catch { throw new Error("Private browser returned invalid closed receipt"); }
    if (receipt.processIsolation !== true || receipt.testRunnerAttached !== false || receipt.tracingEnabled !== false || receipt.videoEnabled !== false || receipt.apiStepRecorder !== false
      || Object.keys(receipt).some(key => !["processIsolation", "testRunnerAttached", "tracingEnabled", "videoEnabled", "apiStepRecorder", "credentialEntered", "connectionId", "challengeVisible", "passwordInput", "autocompleteOff", "humanSubmittedSecurely", "visibleReady", "storageClean", "newTokenId", "tokenUiVisible", "newWorkedBeforeRevocation", "oldWorkedUntilRevocation", "revealedPending", "oldRevoked", "newWorksAfter", "oldStatusAfter", "otherWorksAfter", "requestedSpaceName", "requestedSpaceKey", "savedSpaceName", "savedSpaceKey", "secretId", "secretUiVisible", "bindingId", "routineConfigured", "routineUiVisible", "identityConfirmed", "identityUiVisible", "principalId", "outpostUserId", "endpointId", "slackCredentialUiVisible", "activationUiVisible", "endpointActive", "identityWasAlreadyLinked", "credentialUiRejected", "deviceSessionVerified", "currentCodeVisible", "spaceConsentVisible", "readScopeVisible", "humanApproved", "expiredPageVisible"].includes(key))) throw new Error("Private browser receipt exceeds its closed contract");
    if(input.spaceMetadata!==undefined&&(input.mode!=="space-secret-create"||!validSpaceSecretMetadata(input.spaceMetadata)))throw new Error("Invalid space metadata request");
  if (input.mode.startsWith("device-") && !matchesDevicePrivateReceipt(input.mode, receipt)) throw new Error("Invalid closed device UI receipt");
    if ((input.mode === "slack-wizard-confirm" || input.mode === "slack-wizard-resume") && (receipt.endpointId !== input.slackIdentity?.endpointId || receipt.principalId !== input.slackIdentity?.principalId || receipt.outpostUserId !== input.slackIdentity?.userId || receipt.identityConfirmed !== true || receipt.activationUiVisible !== true || receipt.endpointActive !== true)) throw new Error("Invalid closed Slack wizard completion receipt");
    if ((input.mode === "slack-endpoint-configure" || input.mode === "slack-endpoint-reconnect") && (receipt.endpointId !== input.slackSetup?.endpointId || receipt.slackCredentialUiVisible !== true || (receipt.credentialUiRejected === true ? receipt.humanSubmittedSecurely !== false : receipt.humanSubmittedSecurely !== true || receipt.storageClean !== true))) throw new Error("Invalid closed Slack credential form receipt");
    if (input.mode === "slack-identity-confirm" && (receipt.identityConfirmed !== true || receipt.identityUiVisible !== true || receipt.principalId !== input.slackIdentity?.principalId || receipt.outpostUserId !== input.slackIdentity?.userId)) throw new Error("Invalid closed Slack identity confirmation receipt");
    if (input.mode === "grok-routine-configure" && (receipt.bindingId !== input.grok?.bindingId || receipt.routineConfigured !== true || receipt.routineUiVisible !== true || receipt.visibleReady !== undefined)) throw new Error("Invalid closed Grok routine configuration receipt");
    if(input.mode!=="space-secret-create"&&[receipt.requestedSpaceName,receipt.requestedSpaceKey,receipt.savedSpaceName,receipt.savedSpaceKey].some(value=>value!==undefined))throw new Error("Space metadata receipt on another private operation");
    if(input.mode==="space-secret-create"&&(receipt.secretUiVisible!==true||receipt.humanSubmittedSecurely!==true||receipt.storageClean!==true||!validSpaceSecretMetadata({name:receipt.requestedSpaceName,key:receipt.requestedSpaceKey})||receipt.requestedSpaceName!==(input.spaceMetadata?.name??"Deployment API key")||input.spaceMetadata?.key&&receipt.requestedSpaceKey!==input.spaceMetadata.key||receipt.savedSpaceName!==receipt.requestedSpaceName||typeof receipt.requestedSpaceKey!=="string"||receipt.savedSpaceKey!==canonicalSpaceSecretKey(receipt.requestedSpaceKey)))throw new Error("Invalid space metadata save receipt");
    if (input.mode === "gateway-token-rotation") {
      if (!onToken) throw new Error("Gateway rotation requires its private credential sink");
      const token = JSON.parse(await readFile(path.join(directory, "token.json"), "utf8")) as { id: string; token: string };
      if (!/^[a-f0-9-]{36}$/i.test(token.id) || token.id !== receipt.newTokenId || typeof token.token !== "string" || token.token.length > 8192 || !token.token) throw new Error("Invalid private gateway credential handoff");
      onToken(token);
    }
    return receipt;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
