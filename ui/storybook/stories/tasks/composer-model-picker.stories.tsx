import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { ComposerModelPickerPreview } from "../../prototypes/composer-model-picker/ComposerModelPickerPreview";
import { ComposerRunSettingsLiveStory } from "../../prototypes/composer-model-picker/ComposerRunSettingsLiveStory";

const meta = {
  id: "composer-model-and-effort-picker",
  title: "Tasks and conversations/Task creation and lifecycle/Composer/Model and effort picker",
  component: ComposerModelPickerPreview,
  parameters: {
    layout: "fullscreen",
    options: { showPanel: false },
    docs: { description: { component:
      "The composer picker for the retained Codex and Claude harnesses. The assignee determines the model catalog; changing assignees clears per-message overrides. Custom model IDs remain available, and known models expose their supported effort and fast-mode controls."
    } },
    outpost: {
      capabilities: ["tasks/create", "runs-adapters/availability"],
      status: "mixed",
      implementation: "mixed",
      boundary: "fixtures",
      notes: "Most examples use a local picker implementation; live picker examples use ComposerRunSettingsLiveStory.",
    },
  },
  args: { agentId: "codex", initialPanel: "closed" },
  render: (args) => <ComposerModelPickerPreview key={JSON.stringify(args)} {...args} />,
} satisfies Meta<typeof ComposerModelPickerPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultComposer: Story = {
  name: "01 · Unified assignee and model picker",
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const capsule = screen.getByRole("button", { name: "Select assignee, model and effort" });
    const send = screen.getByRole("button", { name: "Send message" });
    await expect(send.getBoundingClientRect().left - capsule.getBoundingClientRect().right).toBeLessThanOrEqual(16);
  },
};

export const CodexEffort: Story = {
  name: "02 · Codex effort and fast mode",
  args: { initialPanel: "settings", initialEffort: "high" },
};

export const CodexModelSearch: Story = {
  name: "03 · Search Codex models",
  args: { initialPanel: "models" },
};

export const FastModeToggle: Story = {
  name: "04 · Toggle fast mode",
  args: { initialPanel: "settings" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    const toggle = screen.getByRole("button", { name: "Fast mode" });
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  },
};

export const CodexCustomModel: Story = {
  name: "05 · Custom Codex model ID",
  args: { initialModel: "my-private-codex-model", initialPanel: "settings" },
};

export const ResetToAgentDefault: Story = {
  name: "06 · Reset model, effort and fast mode",
  args: { initialModel: "gpt-6-astra", initialEffort: "ultra", initialFast: true, initialPanel: "settings" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await userEvent.click(screen.getByRole("button", { name: "Reset to agent default" }));
    await expect(screen.getByTestId("selected-effort")).toHaveTextContent("Default");
    await expect(screen.getByRole("button", { name: "Choose exact model" })).toHaveTextContent("GPT-6.1 Sol");
    await expect(screen.getByRole("button", { name: "Fast mode" })).toHaveAttribute("aria-pressed", "false");
  },
};

export const Claude: Story = {
  name: "07 · Claude effort range",
  args: { agentId: "claude", initialPanel: "settings", initialEffort: "max" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(screen.getByRole("slider", { name: "Effort" })).toBeVisible();
    await expect(screen.getByTestId("selected-effort")).toHaveTextContent("Max");
  },
};

export const ClaudeHaiku: Story = {
  name: "08 · Claude Haiku without effort override",
  args: { agentId: "claude", initialModel: "claude-haiku-4-5", initialPanel: "settings" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await expect(screen.queryByRole("slider")).toBeNull();
  },
};

export const AgentMenu: Story = {
  name: "09 · Searchable assignee list",
  args: { initialPanel: "agents" },
};

export const AgentSwitchClearsOverrides: Story = {
  name: "10 · Switching agents resets overrides",
  args: { initialModel: "gpt-6-astra", initialEffort: "ultra", initialFast: true, initialPanel: "agents" },
  play: async ({ canvasElement }) => {
    const screen = within(canvasElement.ownerDocument.body);
    await userEvent.click(screen.getByRole("option", { name: /Clara/ }));
    await expect(screen.getByRole("button", { name: "Choose exact model" })).toHaveTextContent("Claude Sonnet 5");
    await expect(screen.queryByRole("button", { name: "Fast mode" })).toBeNull();
  },
};

export const Mobile: Story = {
  name: "11 · Mobile picker",
  args: { agentId: "codex", initialPanel: "settings", compact: true },
  globals: { viewport: { value: "mobile1", isRotated: false } },
};

export const Light: Story = {
  name: "12 · Light theme",
  args: { agentId: "claude", initialPanel: "settings" },
  globals: { theme: "light" },
};

export const ProductionComposer: Story = {
  name: "13 · App picker in composer",
  render: () => <ComposerRunSettingsLiveStory initialPanel="models" />,
};

export const ProductionClaudeEffort: Story = {
  name: "14 · App Claude effort",
  render: () => <ComposerRunSettingsLiveStory agentId="claude" initialPanel="settings" initialEffort="max" />,
};

export const ProductionMobileComposer: Story = {
  name: "15 · App picker on mobile",
  render: () => <ComposerRunSettingsLiveStory initialPanel="settings" mobile compact />,
  globals: { viewport: { value: "mobile1", isRotated: false } },
};

export const ProductionLongLabels: Story = {
  name: "16 · Long labels",
  render: () => <ComposerRunSettingsLiveStory agentId="long-labels" compact />,
};
