import type { Meta, StoryObj } from "@storybook/react-vite";
import { PrimaryPage, mobile, primaryDecorator, primaryParameters } from "../../../support/default-agent/DefaultAgentStory";

export default { id: "default-agent-04-new-task",
  title: "Agents and reusable capabilities/Creation, configuration, and organization/Primary Agent/04 New task", decorators: [primaryDecorator], parameters: { ...primaryParameters, outpost: {
      "capabilities": [
        "agents/default-agent",
        "tasks/create",
        "agent-chat/discovery"
      ],
      "implementation": "production",
      "boundary": "fixtures",
      "notes": "Primary choice, replacement confirmation, unavailable states and task/chat fallback presentation use local presentation-provider callbacks. Production preference persistence and default-resolution precedence remain unverified by this suite. The filter uses one lowercase label without helper text. All chat-channel tasks count as bot-created; the focused visibility stories cover human-initiated channel work."
    } }, render: () => <PrimaryPage task="primary" /> } satisfies Meta;
type Story = StoryObj;
export const PrimaryFallback: Story = {};
export const RecentSpecialistWins: Story = { parameters: { defaultAgent: { recentAssignee: true } }, render: () => <PrimaryPage task="recent" /> };
export const ExplicitAssignmentWins: Story = { parameters: { defaultAgent: { recentAssignee: true } }, render: () => <PrimaryPage task="explicit" /> };
export const RestoredDraftWins: Story = { parameters: { defaultAgent: { recentAssignee: true } }, render: () => <PrimaryPage task="draft" /> };
export const NoPrimary: Story = { parameters: { defaultAgent: { primaryId: null } } };
export const UnavailablePrimary: Story = { parameters: { defaultAgent: { unavailable: true } } };
export const PausedPrimary: Story = { parameters: { defaultAgent: { paused: true } } };
export const MobilePrimary: Story = { globals: mobile };
export const MobileDraft: Story = { ...RestoredDraftWins, globals: mobile };
