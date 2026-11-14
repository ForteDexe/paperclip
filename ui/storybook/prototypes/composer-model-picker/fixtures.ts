import { codexLocalReasoningEffortsForModel, isCodexLocalFastModeSupported, isCodexLocalKnownModel } from "@outpost/adapter-codex-local";
import { claudeLocalReasoningEffortsForModel } from "@outpost/adapter-claude-local";
import { AGENT_PALETTE_IDS, appearanceForPalette } from "@outpost/shared";

export type ModelOption = { id: string; label: string; detail?: string };
export type ComposerAgent = {
  id: string;
  name: string;
  role: string;
  harness: string;
  adapterType: string;
  provider?: string;
  engine?: string;
  defaultModel?: string;
  defaultLabel?: string;
  models: ModelOption[];
  manualPattern?: string;
  noModelReason?: string;
};

const codexModels: ModelOption[] = [
  { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", detail: "Agent default" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { id: "gpt-6-astra", label: "GPT-6 Astra", detail: "Extended effort range" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { id: "gpt-5.5", label: "GPT-5.5" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", detail: "Fast mode unavailable" },
];

export const composerAgents: ComposerAgent[] = [
  { id: "codex", name: "Codie", role: "Engineering", harness: "Codex", adapterType: "codex_local", defaultModel: "gpt-6.1-sol", models: codexModels, manualPattern: "Model ID, e.g. gpt-6.1-sol" },
  { id: "claude", name: "Clara", role: "Research", harness: "Claude Code", adapterType: "claude_local", defaultModel: "claude-sonnet-5", models: [
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-opus-5", label: "Claude Opus 5" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ], manualPattern: "Claude model ID" },
  { id: "long-labels", name: "Alexandra Engineering Coordinator", role: "Engineering", harness: "Codex", adapterType: "codex_local", defaultModel: "gpt-6.1-sol", models: [
    { id: "gpt-6.1-sol", label: "GPT-6.1 Sol Extended Context Preview", detail: "Agent default" },
  ], manualPattern: "Model ID, e.g. gpt-6.1-sol" },
];

/** Share the capsule-avatar palettes used by the agent persona stories. */
export function composerAgentAppearance(agentId: string) {
  const index = Math.max(0, composerAgents.findIndex((agent) => agent.id === agentId));
  return appearanceForPalette(AGENT_PALETTE_IDS[index % AGENT_PALETTE_IDS.length]);
}

export const effortLabels: Record<string, string> = {
  minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra High", max: "Max", ultra: "Ultra", off: "Off",
};

export function effortChoices(agent: ComposerAgent, model: string): readonly string[] {
  const effectiveModel = model.trim();
  if (agent.adapterType === "codex_local") return isCodexLocalKnownModel(effectiveModel) ? codexLocalReasoningEffortsForModel(effectiveModel) : [];
  if (!agent.models.some((option) => option.id === effectiveModel)) return [];
  if (agent.adapterType === "claude_local") return claudeLocalReasoningEffortsForModel(effectiveModel);
  return [];
}

export function fastModeAvailable(agent: ComposerAgent, model: string): boolean {
  return agent.adapterType === "codex_local"
    && isCodexLocalKnownModel(model)
    && isCodexLocalFastModeSupported(model);
}

export function modelLabel(agent: ComposerAgent, model: string): string {
  if (!model) return agent.defaultLabel ?? "Default";
  return agent.models.find((option) => option.id === model)?.label ?? model;
}
