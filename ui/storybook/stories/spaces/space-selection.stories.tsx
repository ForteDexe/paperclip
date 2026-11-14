import type { Meta, StoryObj } from "@storybook/react-vite";
import { Spaces } from "@/pages/Spaces";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { storybookSpaces } from "../../fixtures/outpostData";
import {
  prepareFixtureApi,
  type FixtureState,
} from "../../support/capability-gaps/api";
const meta = {
  id: "feature-space-selection",
  title:
    "Getting started and access/Spaces and portability/Selection and archived organizations",
  component: Spaces,
  parameters: { layout: "padded",
    outpost: {
      "capabilities": [
        "spaces/selection",
        "spaces/archive"
      ],
      "status": "current",
      "implementation": "production",
      "boundary": "fixtures",
      "notes": "Spaces list, selection storage and archived-space restoration with loading/empty/error/403. This covers the archive list/restoration side; SpaceSettings archive confirmation remains an additional UI scenario."
    },
  },
  beforeEach: ({ parameters }) => {
    let spaces =
      parameters.fixtureState === "empty"
        ? []
        : [
            ...storybookSpaces.map((c) => ({ ...c })),
            {
              ...storybookSpaces[0],
              id: "archived-gap",
              name: "Archived Research",
              issuePrefix: "ARC",
              status: "archived",
            },
          ];
    return prepareFixtureApi(
      [
        { path: "/api/spaces", read: () => spaces },
        { path: "/api/spaces/stats", read: () => ({}) },
        {
          path: "/api/spaces/archived-gap",
          method: "PATCH",
          read: ({ body }) => {
            spaces = spaces.map((c) =>
              c.id === "archived-gap" ? { ...c, ...body } : c,
            );
            return spaces.find((c) => c.id === "archived-gap");
          },
        },
      ],
      parameters.fixtureState as FixtureState,
    ).cleanup;
  },
} satisfies Meta<typeof Spaces>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Organizations: Story = {};
export const Loading: Story = { parameters: { fixtureState: "loading" } };
export const Empty: Story = { parameters: { fixtureState: "empty" } };
export const Failed: Story = { parameters: { fixtureState: "failure" } };
export const PermissionDenied: Story = {
  parameters: { fixtureState: "permission" },
};
export const SelectOrganization: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const card = await c.findByRole("button", { name: /Archived Research/ });
    await userEvent.click(card);
    await waitFor(() =>
      expect(localStorage.getItem("outpost.selectedSpaceId")).toBe(
        "archived-gap",
      ),
    );
  },
};
export const Unarchive: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const card = (await c.findByText("Archived Research")).closest(
      '[role="button"]',
    ) as HTMLElement;
    await userEvent.click(
      card.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!,
    );
    await userEvent.click(
      await within(document.body).findByRole("menuitem", { name: "Unarchive" }),
    );
    await waitFor(() => {
      const restored = within(canvasElement)
        .getByText("Archived Research")
        .closest('[role="button"]') as HTMLElement;
      expect(within(restored).getByText("active")).toBeVisible();
    });
  },
};
