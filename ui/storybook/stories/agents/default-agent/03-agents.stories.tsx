import type { Meta, StoryObj } from "@storybook/react-vite";
import { PrimaryPage, mobile, primaryDecorator, primaryParameters } from "../../../support/default-agent/DefaultAgentStory";

export default { id: "default-agent-03-agents",
  title: "Agents and reusable capabilities/Creation, configuration, and organization/Primary Agent/03 Agents", decorators: [primaryDecorator], parameters: { ...primaryParameters, outpost: {
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
export const Roster: Story = {};
export const Profile: Story = { parameters: { initialEntries: ["/PAP/agents/maia"] } };
export const SpecialistProfile: Story = { parameters: { initialEntries: ["/PAP/agents/alex"] } };
export const FirstCreatedAgent: Story = { parameters: { defaultAgent: { firstCreated: true } } };
export const PausedPrimary: Story = { parameters: { defaultAgent: { paused: true }, initialEntries: ["/PAP/agents/maia"] } };
export const ErrorPrimary: Story = { parameters: { defaultAgent: { error: true }, initialEntries: ["/PAP/agents/maia"] } };
export const PreviouslyLeftAgent: Story = { parameters: { defaultAgent: { leftPrimary: true }, initialEntries: ["/PAP/agents/maia"] } };
export const UnavailablePrimary: Story = { parameters: { defaultAgent: { unavailable: true } } };
export const ClearedPrimary: Story = { parameters: { defaultAgent: { primaryId: null } } };
export const MobileRoster: Story = { globals: mobile };
export const MobileProfile: Story = { ...Profile, globals: mobile };
export const MobileSpecialistProfile: Story = { ...SpecialistProfile, globals: mobile };
export const LoadingProfile: Story = { ...SpecialistProfile, parameters: { ...SpecialistProfile.parameters, defaultAgent: { loading: true } } };
export const ClassicProfile: Story = { ...Profile, parameters: { ...Profile.parameters, defaultAgent: { classic: true } } };
