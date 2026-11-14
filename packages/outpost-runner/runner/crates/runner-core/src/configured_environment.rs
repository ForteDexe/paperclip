//! Controller-selected task environment; mirrors configured-environment.ts.
use crate::local_runner::LocalRunnerError;
use std::process::Command;

const MARKER: &str = "OUTPOST_CONFIGURED_ENV_KEYS";
const RESERVED: &[&str] = &[
    "OUTPOST_OBSERVABILITY_CODEX_CONFIG",
    "OUTPOST_OBSERVABILITY_OPENCODE",
    "CLAUDE_CODE_ENABLE_TELEMETRY",
    "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA",
    "ENABLE_ENHANCED_TELEMETRY_BETA",
    "OTEL_LOGS_EXPORTER",
    "OTEL_TRACES_EXPORTER",
    "OTEL_METRICS_EXPORTER",
    "OTEL_RESOURCE_ATTRIBUTES",
    "OTEL_EXPORTER_OTLP_ENDPOINT",
    "OTEL_EXPORTER_OTLP_PROTOCOL",
    "OTEL_EXPORTER_OTLP_HEADERS",
    "OTEL_EXPORTER_OTLP_TIMEOUT",
    "OTEL_EXPORTER_OTLP_LOGS_PROTOCOL",
    "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL",
    "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
    "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
    "OTEL_EXPORTER_OTLP_LOGS_HEADERS",
    "OTEL_EXPORTER_OTLP_TRACES_HEADERS",
    "OTEL_EXPORTER_OTLP_LOGS_TIMEOUT",
    "OTEL_EXPORTER_OTLP_TRACES_TIMEOUT",
    "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
    "OTEL_EXPORTER_OTLP_METRICS_HEADERS",
    "OTEL_EXPORTER_OTLP_METRICS_PROTOCOL",
    "OTEL_LOG_USER_PROMPTS",
    "OTEL_LOG_ASSISTANT_RESPONSES",
    "OTEL_LOG_TOOL_DETAILS",
    "OTEL_LOG_TOOL_CONTENT",
    "OTEL_LOG_RAW_API_BODIES",
    "AGENT_HOME",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "AWS_BEARER_TOKEN_BEDROCK",
    "BASH_ENV",
    "ZDOTDIR",
    "GH_CONFIG_DIR",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CODEX_API_KEY",
    "CODEX_HOME",
    "COPILOT_GITHUB_TOKEN",
    "CURSOR_API_KEY",
    "CURSOR_AUTH_TOKEN",
    "ENV",
    "GH_ENTERPRISE_TOKEN",
    "GH_TOKEN",
    "GITHUB_ENTERPRISE_TOKEN",
    "GITHUB_TOKEN",
    "HOME",
    "KIMI_API_KEY",
    "NODE_OPTIONS",
    "NODE_PATH",
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "OUTPOST_ACPX_CREDENTIAL_BINDING",
    "OUTPOST_AGENT_ID",
    "OUTPOST_AGENT_KEY_ID",
    "OUTPOST_AGENT_MESSAGE_KEY",
    "OUTPOST_AGENT_PRIVATE_KEY",
    "OUTPOST_AGENT_PUBLIC_KEY",
    "OUTPOST_AI_PROVIDER_KEY",
    "OUTPOST_API_BRIDGE_MODE",
    "OUTPOST_API_KEY",
    "OUTPOST_API_URL",
    "OUTPOST_APPROVAL_ID",
    "OUTPOST_APPROVAL_STATUS",
    "OUTPOST_COMPANY_ID",
    "OUTPOST_CONFIGURED_ENV_KEYS",
    "OUTPOST_EXECUTION_MODE",
    "OUTPOST_EXTERNAL_CHAT_EXECUTION_BOUND_KEY",
    "OUTPOST_GITHUB_AUTH_MODE",
    "OUTPOST_GITHUB_BRIDGE_TOKEN",
    "OUTPOST_GITHUB_BROKER_TOKEN",
    "OUTPOST_GITHUB_BROKER_URL",
    "OUTPOST_GITHUB_HOST_HOME",
    "OUTPOST_GITHUB_LAUNCHER_DIR",
    "OUTPOST_GIT_METADATA_ROOTS",
    "OUTPOST_GIT_TOKEN",
    "OUTPOST_HARNESS_CHECKOUT_KEY",
    "OUTPOST_INSTANCE_ID",
    "OUTPOST_LINKED_ISSUE_IDS",
    "OUTPOST_NATIVE_MCP_NAME",
    "OUTPOST_NATIVE_MCP_TOKEN",
    "OUTPOST_NATIVE_MCP_URL",
    "OUTPOST_NATIVE_MCP_STDIO",
    "OUTPOST_NATIVE_MCP_PROXY",
    "OUTPOST_NORMALIZED_SESSION_ID",
    "OUTPOST_PROVIDER_TRACE_MAX_BYTES",
    "OUTPOST_PROVIDER_TRACE_PATH",
    "OUTPOST_RUNNER_BOOTSTRAP_TICKET",
    "OUTPOST_RUNNER_EXTERNAL_SANDBOX",
    "OUTPOST_RUNNER_INSTANCE_ID",
    "OUTPOST_RUNNER_NETWORK_ACCESS",
    "OUTPOST_RUNNER_NETWORK_ROOTS",
    "OUTPOST_RUNTIME_PRIMARY_URL",
    "OUTPOST_RUNTIME_SERVICES_JSON",
    "OUTPOST_RUNTIME_SERVICE_INTENTS_JSON",
    "OUTPOST_RUN_ID",
    "OUTPOST_RUNTIME_NOTIFICATION_CONTEXT",
    "OUTPOST_RUNTIME_NOTIFICATION_HELPER",
    "OUTPOST_TASK_ID",
    "OUTPOST_WAKE_COMMENT_ID",
    "OUTPOST_WAKE_PAYLOAD_JSON",
    "OUTPOST_WAKE_REASON",
    "OUTPOST_WORKSPACES_JSON",
    "OUTPOST_WORKSPACE_AUTHORITATIVE_ROOT",
    "OUTPOST_WORKSPACE_BRANCH",
    "OUTPOST_WORKSPACE_CWD",
    "OUTPOST_WORKSPACE_ID",
    "OUTPOST_WORKSPACE_REALIZATION_MODE",
    "OUTPOST_WORKSPACE_REPO_REF",
    "OUTPOST_WORKSPACE_REPO_URL",
    "OUTPOST_WORKSPACE_SOURCE",
    "OUTPOST_WORKSPACE_WORKTREE_PATH",
    "PATH",
    "PERL5LIB",
    "PERL5OPT",
    "PYTHONHOME",
    "PYTHONPATH",
    "RUBYLIB",
    "RUBYOPT",
    "SHELL",
    "USERPROFILE",
    "XAI_API_KEY",
];

fn eligible_key(key: &str) -> bool {
    let upper = key.to_ascii_uppercase();
    !key.is_empty()
        && key.len() <= 128
        && key
            .bytes()
            .enumerate()
            .all(|(i, b)| b == b'_' || b.is_ascii_alphabetic() || (i > 0 && b.is_ascii_digit()))
        && !RESERVED.contains(&upper.as_str())
        && ![
            "LD_",
            "DYLD_",
            "GIT_CONFIG_",
            "OUTPOST_RUNNER_",
            "OUTPOST_NATIVE_",
            "OUTPOST_CURSOR_CLOUD_",
            "OUTPOST_GITHUB_",
            "OUTPOST_ACPX_",
            "OUTPOST_VERIFIED_",
        ]
        .iter()
        .any(|prefix| upper.starts_with(prefix))
}

pub(crate) fn apply_configured_environment(
    command: &mut Command,
    lookup: impl Fn(&str) -> Option<String>,
) -> Result<(), LocalRunnerError> {
    let Some(raw) = lookup(MARKER) else {
        return Ok(());
    };
    let invalid = || LocalRunnerError::invalid("invalid configured environment projection");
    if raw.len() > 20_000 {
        return Err(invalid());
    }
    let mut names: Vec<String> = serde_json::from_str(&raw).map_err(|_| invalid())?;
    if names.len() > 128 || names.iter().any(|name| !eligible_key(name)) {
        return Err(invalid());
    }
    names.sort();
    if names.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(invalid());
    }
    let mut bytes = 0;
    // Validate all values before modifying the child launch specification.
    let mut values = Vec::new();
    for name in &names {
        let value = lookup(name).ok_or_else(invalid)?;
        let size = name.len() + value.len();
        bytes += size;
        if value.contains('\0') || size > 65_536 || bytes > 262_144 {
            return Err(invalid());
        }
        values.push((name, value));
    }
    command.envs(values);
    command.env(
        MARKER,
        serde_json::to_string(&names).map_err(|_| invalid())?,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn rejects_reserved_malformed_missing_and_oversized_environment() {
        for raw in [
            "not-json",
            "[1]",
            "[\"NODE_OPTIONS\"]",
            "[\"BASH_ENV\"]",
            "[\"ZDOTDIR\"]",
            "[\"GH_CONFIG_DIR\"]",
            "[\"OUTPOST_API_KEY\"]",
            "[\"OUTPOST_RUNNER_BOOTSTRAP_TICKET\"]",
            "[\"OUTPOST_RUNTIME_NOTIFICATION_CONTEXT\"]",
            "[\"OUTPOST_RUNTIME_NOTIFICATION_HELPER\"]",
            "[\"OPENAI_API_KEY\"]",
            "[\"KIMI_API_KEY\"]",
            "[\"LD_PRELOAD\"]",
            "[\"bad=name\"]",
            "[\"CUSTOM\",\"CUSTOM\"]",
            "[\"MISSING\"]",
        ] {
            let mut command = Command::new("unused");
            assert!(
                apply_configured_environment(&mut command, |key| if key == MARKER {
                    Some(raw.into())
                } else {
                    None
                })
                .is_err()
            );
            assert_eq!(command.get_envs().count(), 0);
        }
        let mut command = Command::new("unused");
        assert!(apply_configured_environment(&mut command, |key| match key {
            MARKER => Some("[\"KIMI_API_KEY\"]".into()),
            "KIMI_API_KEY" => Some("selected-code-key".into()),
            _ => None,
        })
        .is_err());
        assert_eq!(command.get_envs().count(), 0);
        let mut command = Command::new("unused");
        assert!(
            apply_configured_environment(&mut command, |key| Some(if key == MARKER {
                "[\"CUSTOM\"]".into()
            } else {
                "x".repeat(65_536)
            }))
            .is_err()
        );
    }

    #[test]
    #[cfg(unix)]
    fn child_receives_only_selected_task_values_across_configuration_changes() {
        for secret in [None, Some("first-secret"), Some("rotated-secret"), None] {
            let mut source = BTreeMap::from([
                ("HOST_SECRET", "unbound-secret".to_string()),
                ("NODE_OPTIONS", "unbound-loader".to_string()),
            ]);
            let names = if let Some(value) = secret {
                source.insert("OUTPOST_PAGE_AWS_SECRET_ACCESS_KEY", value.into());
                vec!["OUTPOST_PAGE_AWS_SECRET_ACCESS_KEY"]
            } else {
                vec![]
            };
            source.insert(MARKER, serde_json::to_string(&names).unwrap());
            let mut command = Command::new("/bin/sh");
            command.env_clear().args(["-c", "printf '%s|%s|%s' \"$OUTPOST_PAGE_AWS_SECRET_ACCESS_KEY\" \"$HOST_SECRET\" \"$NODE_OPTIONS\""]);
            apply_configured_environment(&mut command, |key| source.get(key).cloned()).unwrap();
            let output = command.output().unwrap();
            assert!(output.status.success());
            assert_eq!(
                String::from_utf8(output.stdout).unwrap(),
                format!("{}||", secret.unwrap_or_default())
            );
        }
    }
}
