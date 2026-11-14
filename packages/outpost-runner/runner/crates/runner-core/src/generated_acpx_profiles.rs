// Generated from acpx-profiles.json and cursor-distributions.json. Do not edit.
pub(crate) const QUALIFIED_ACPX_VERSION: &str = "0.22.0";
pub(crate) const ACPX_DRIVER_KIND: &str = "acpx_runtime";

#[derive(Debug)]
pub(crate) struct AcpxReleaseProfile {
    pub agent_server_package: &'static str,
    pub agent_server_version: &'static str,
    pub agent_runtime_package: Option<&'static str>,
    pub agent_runtime_version: Option<&'static str>,
    pub command_digest: &'static str,
    pub requires_provider_policy: bool,
    pub qualification_pending: bool,
}

pub(crate) fn kimi_native_closure(platform: &str, architecture: &str) -> Option<&'static str> {
    match (platform, architecture) {
        ("darwin", "arm64") => {
            Some("6038325abd0431c30097ff1f572a9b29816e1b4da372d8cb86b2ca5d18ea34e7")
        }
        ("linux", "x64") => {
            Some("105d8394adbbc76a953a12cc51b5288eb940ad693291e584f6cdc6407213164d")
        }
        _ => None,
    }
}

pub(crate) fn acpx_release_profile(agent: &str) -> Option<AcpxReleaseProfile> {
    Some(match agent {
        "antigravity" => AcpxReleaseProfile {
            agent_server_package: "native:antigravity-acp",
            agent_server_version: "1.4.3",
            agent_runtime_package: Some("native:antigravity-localharness"),
            agent_runtime_version: Some("1.4.3"),
            command_digest:
                "sha256:e22eed6a28cccbd4555c63c5e4f0c5bf65cb80805611b572d7c4d9e8520bc1e2",
            requires_provider_policy: true,
            qualification_pending: true,
        },
        "grok" => AcpxReleaseProfile {
            agent_server_package: "builtin:grok-acp",
            agent_server_version: "1",
            agent_runtime_package: Some("native:grok"),
            agent_runtime_version: Some("1.0.13"),
            command_digest:
                "sha256:af36e8c9f651711477160944da316b1aa9282e3dcebf55ab4663ebc8efa105f0",
            requires_provider_policy: false,
            qualification_pending: false,
        },
        "pi" => AcpxReleaseProfile {
            agent_server_package: "pi-acp",
            agent_server_version: "0.0.33",
            agent_runtime_package: Some("@earendil-works/pi-coding-agent"),
            agent_runtime_version: Some("1.0.0"),
            command_digest:
                "sha256:d10ae9e14f9e77797db4198723326ef2476f6cd7af4338a32b6fec9bb309a0fe",
            requires_provider_policy: true,
            qualification_pending: false,
        },
        "cursor" => AcpxReleaseProfile {
            agent_server_package: "cursor-agent",
            agent_server_version: "2026.09.26-dd393fe",
            agent_runtime_package: None,
            agent_runtime_version: None,
            command_digest:
                "sha256:4866bf1f285410329b24d441e23a24c9c36cee424596f0df7d73bff1870dfba9",
            requires_provider_policy: true,
            qualification_pending: false,
        },
        "copilot" => AcpxReleaseProfile {
            agent_server_package: "@github/copilot",
            agent_server_version: "1.0.88",
            agent_runtime_package: None,
            agent_runtime_version: None,
            command_digest:
                "sha256:d23ac91c7ca54831bc298326bc7691d3b622ef9d749c2cd0b63c3909a556536f",
            requires_provider_policy: true,
            qualification_pending: false,
        },
        "claude" => AcpxReleaseProfile {
            agent_server_package: "@agentclientprotocol/claude-agent-acp",
            agent_server_version: "0.73.0",
            agent_runtime_package: Some("@anthropic-ai/claude-agent-sdk"),
            agent_runtime_version: Some("0.3.286"),
            command_digest:
                "sha256:9d73d1f0f121fb96cc8badb28c22d5bff02d8582eb2e40360a81c189e1b9422a",
            requires_provider_policy: false,
            qualification_pending: false,
        },
        "codex" => AcpxReleaseProfile {
            agent_server_package: "@agentclientprotocol/codex-acp",
            agent_server_version: "1.6.2",
            agent_runtime_package: Some("@openai/codex"),
            agent_runtime_version: Some("0.160.0"),
            command_digest:
                "sha256:443491f4e814501a5dc47347e4510e84faeec9c9382e2d4e53bfe69386d5aabc",
            requires_provider_policy: false,
            qualification_pending: false,
        },
        "kimi" => AcpxReleaseProfile {
            agent_server_package: "@moonshot-ai/kimi-code",
            agent_server_version: "2.3.3",
            agent_runtime_package: None,
            agent_runtime_version: None,
            command_digest:
                "sha256:3aa9680f7110f6d65d736b41370bf02f3f24f4ff97f4196fe5b3c6e54f8135d5",
            requires_provider_policy: true,
            qualification_pending: false,
        },
        _ => return None,
    })
}
