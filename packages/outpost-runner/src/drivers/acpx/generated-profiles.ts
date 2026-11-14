// Generated from acpx-profiles.json and cursor-distributions.json. Do not edit.
export const QUALIFIED_ACPX_VERSION = "0.22.0" as const;
export const ACPX_DRIVER_KIND = "acpx_runtime" as const;
export const ACPX_DRIVER_PROTOCOL_VERSION = 1 as const;

export const QUALIFIED_ACPX_PROFILE_DATA = {
  "antigravity": {
    "driverKind": "acpx_runtime",
    "protocolVersion": 1,
    "acpxVersion": "0.22.0",
    "agent": "antigravity",
    "agentProfileVersion": 1,
    "agentServerPackage": "native:antigravity-acp",
    "agentServerVersion": "1.4.3",
    "agentRuntimePackage": "native:antigravity-localharness",
    "agentRuntimeVersion": "1.4.3",
    "commandDigest": "sha256:e22eed6a28cccbd4555c63c5e4f0c5bf65cb80805611b572d7c4d9e8520bc1e2",
    "qualificationStatus": "pending",
    "permissionPolicy": "interactive"
  },
  "grok": {
    "driverKind": "acpx_runtime",
    "protocolVersion": 1,
    "acpxVersion": "0.22.0",
    "agent": "grok",
    "agentProfileVersion": 20,
    "agentServerPackage": "builtin:grok-acp",
    "agentServerVersion": "1",
    "agentRuntimePackage": "native:grok",
    "agentRuntimeVersion": "1.0.13",
    "commandDigest": "sha256:af36e8c9f651711477160944da316b1aa9282e3dcebf55ab4663ebc8efa105f0",
    "permissionPolicy": "interactive"
  },
  "pi": {
    "driverKind": "acpx_runtime",
    "protocolVersion": 1,
    "acpxVersion": "0.22.0",
    "agent": "pi",
    "agentProfileVersion": 37,
    "agentServerPackage": "pi-acp",
    "agentServerVersion": "0.0.33",
    "agentRuntimePackage": "@earendil-works/pi-coding-agent",
    "agentRuntimeVersion": "1.0.0",
    "commandDigest": "sha256:d10ae9e14f9e77797db4198723326ef2476f6cd7af4338a32b6fec9bb309a0fe",
    "permissionPolicy": "interactive"
  },
  "cursor": {
    "driverKind": "acpx_runtime",
    "protocolVersion": 1,
    "acpxVersion": "0.22.0",
    "agent": "cursor",
    "agentProfileVersion": 17,
    "agentServerPackage": "cursor-agent",
    "agentServerVersion": "2026.09.26-dd393fe",
    "agentRuntimePackage": null,
    "agentRuntimeVersion": null,
    "commandDigest": "sha256:4866bf1f285410329b24d441e23a24c9c36cee424596f0df7d73bff1870dfba9",
    "permissionPolicy": "interactive"
  },
  "copilot": {
    "driverKind": "acpx_runtime",
    "protocolVersion": 1,
    "acpxVersion": "0.22.0",
    "agent": "copilot",
    "agentProfileVersion": 92,
    "agentServerPackage": "@github/copilot",
    "agentServerVersion": "1.0.88",
    "agentRuntimePackage": null,
    "agentRuntimeVersion": null,
    "commandDigest": "sha256:d23ac91c7ca54831bc298326bc7691d3b622ef9d749c2cd0b63c3909a556536f",
    "permissionPolicy": "interactive"
  },
  "claude": {
    "driverKind": "acpx_runtime",
    "protocolVersion": 1,
    "acpxVersion": "0.22.0",
    "agent": "claude",
    "agentProfileVersion": 1,
    "agentServerPackage": "@agentclientprotocol/claude-agent-acp",
    "agentServerVersion": "0.73.0",
    "agentRuntimePackage": "@anthropic-ai/claude-agent-sdk",
    "agentRuntimeVersion": "0.3.286",
    "commandDigest": "sha256:9d73d1f0f121fb96cc8badb28c22d5bff02d8582eb2e40360a81c189e1b9422a",
    "permissionPolicy": "interactive"
  },
  "codex": {
    "driverKind": "acpx_runtime",
    "protocolVersion": 1,
    "acpxVersion": "0.22.0",
    "agent": "codex",
    "agentProfileVersion": 1,
    "agentServerPackage": "@agentclientprotocol/codex-acp",
    "agentServerVersion": "1.6.2",
    "agentRuntimePackage": "@openai/codex",
    "agentRuntimeVersion": "0.160.0",
    "commandDigest": "sha256:443491f4e814501a5dc47347e4510e84faeec9c9382e2d4e53bfe69386d5aabc",
    "permissionPolicy": "interactive"
  },
  "kimi": {
    "driverKind": "acpx_runtime",
    "protocolVersion": 1,
    "acpxVersion": "0.22.0",
    "agent": "kimi",
    "agentProfileVersion": 17,
    "agentServerPackage": "@moonshot-ai/kimi-code",
    "agentServerVersion": "2.3.3",
    "agentRuntimePackage": null,
    "agentRuntimeVersion": null,
    "commandDigest": "sha256:3aa9680f7110f6d65d736b41370bf02f3f24f4ff97f4196fe5b3c6e54f8135d5",
    "permissionPolicy": "interactive"
  }
} as const;

export const CURSOR_DISTRIBUTION_PINS = {
  "darwin-arm64": {
    "closureSha256": "257424bd48e35412091c6adfc61e4648e836757ec1d240d890bba81a24918c30",
    "executable": "node",
    "entrypoint": "index.js"
  },
  "darwin-x64": {
    "closureSha256": "6f28c799c5afdc64fbdff8a2157f565f17ae7615efe014ac389d63bf70cf2be2",
    "executable": "node",
    "entrypoint": "index.js"
  },
  "linux-x64": {
    "closureSha256": "eadb8bb8ffb0450455b15b88c9b230307a9e149958a0c452d16dd157b4633d74",
    "executable": "node",
    "entrypoint": "index.js"
  }
} as const;

export const ANTIGRAVITY_DISTRIBUTION_PINS = {
  "darwin-arm64": {
    "closureSha256": "044792d793e203bc8b4524a418f1816c4d34db67bb41fa4bae5947a050c49b4a",
    "executable": "agy_acp_server.par",
    "args": []
  }
} as const;
