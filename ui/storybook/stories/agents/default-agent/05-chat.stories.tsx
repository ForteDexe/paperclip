import type { Meta, StoryObj } from "@storybook/react-vite";
import { PrimaryPage, mobile, primaryDecorator, primaryParameters } from "../../../support/default-agent/DefaultAgentStory";

export default { id: "default-agent-05-chat",
  title: "Agents and reusable capabilities/Hiring, configuration, and organization/Primary Agent/05 Chat", decorators: [primaryDecorator], parameters: { ...primaryParameters, initialEntries: ["/PAP/chats"],
    outpost: {
      "capabilities": [
        "agents/default-agent",
        "tasks/create",
        "agent-chat/discovery"
      ],
      "implementation": "production",
      "boundary": "fixtures",
      "notes": "Primary choice, replacement confirmation, unavailable states and task/chat fallback presentation use local presentation-provider callbacks. Production preference persistence and default-resolution precedence remain unverified by this suite. The filter uses one lowercase label without helper text. All chat-channel tasks count as bot-created; the focused visibility stories cover human-initiated channel work."
    },
  }, render: () => <PrimaryPage /> } satisfies Meta;
type Story = StoryObj;
export const PrimaryFallback: Story = {};
export const RecentConversationWins: Story = { parameters: { defaultAgent: { recentChat: true } } };
export const NoPrimaryChooser: Story = { parameters: { defaultAgent: { primaryId: null } } };
export const PausedPrimary: Story = { parameters: { defaultAgent: { paused: true } } };
export const UnavailablePrimaryChooser: Story = { parameters: { defaultAgent: { unavailable: true } } };
export const MobilePrimary: Story = { globals: mobile };
export const MobileChooser: Story = { ...NoPrimaryChooser, globals: mobile };
export const Light: Story = { globals: { theme: "light" } };
