import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { PrimaryPage, mobile, primaryDecorator, primaryParameters } from "../../../support/default-agent/DefaultAgentStory";

export default { id: "default-agent-02-sidebar",
  title: "Agents and reusable capabilities/Creation, configuration, and organization/Primary Agent/02 Sidebar", decorators: [primaryDecorator], parameters: { ...primaryParameters, outpost: {
      "capabilities": [
        "agents/default-agent",
        "tasks/create",
        "agent-chat/discovery"
      ],
      "implementation": "production",
      "boundary": "fixtures",
      "notes": "Primary choice, replacement confirmation, unavailable states and task/chat fallback presentation use local presentation-provider callbacks. Production preference persistence and default-resolution precedence remain unverified by this suite. The filter uses one lowercase label without helper text. All chat-channel tasks count as bot-created; the focused visibility stories cover human-initiated channel work."
    } }, args: { primaryName: "Maia" }, argTypes: { primaryName: { control: "text" } }, render: () => <PrimaryPage /> } satisfies Meta;
type Story = StoryObj;
export const IdlePrimary: Story = {};
export const ActiveColleague: Story = { parameters: { defaultAgent: { active: true } } };
export const ActivePrimary: Story = { parameters: { defaultAgent: { activePrimary: true } } };
export const LongName: Story = { args: { primaryName: "Maia · Strategy and cross-functional operations" } };
export const PrimaryIsAlsoStarred: Story = { parameters: { defaultAgent: { primaryId: "agent-qa" } } };
export const SectionCollapsed: Story = { play: async ({ canvasElement }) => {
  const page = within(canvasElement.ownerDocument.body);
  await userEvent.click(await page.findByRole("button", { name: "Collapse Agents" }));
} };
export const MobileDrawer: Story = { globals: mobile, render: () => <PrimaryPage drawer /> };
export const MobileDrawerClosed: Story = { globals: mobile };
export const ClassicShell: Story = { parameters: { defaultAgent: { classic: true } } };
export const LoadingPreference: Story = { parameters: { defaultAgent: { loading: true } } };
export const NoPrimary: Story = { parameters: { defaultAgent: { primaryId: null } } };
export const Light: Story = { globals: { theme: "light" } };
