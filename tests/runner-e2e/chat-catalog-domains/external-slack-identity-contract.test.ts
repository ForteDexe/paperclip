import { expect, it } from "vitest";
import {
  validSlackIdentityInput,
  matchingSlackIdentityPreview,
} from "./external-slack-identity-contract.js";
const spaceId = "11111111-1111-4111-8111-111111111111",
  input = {
    endpointId: "22222222-2222-4222-8222-222222222222",
    principalId: "33333333-3333-4333-8333-333333333333",
    userId: "fixture-person",
    externalDetail: "@fixture.human",
    externalLabel: "Fixture Human",
  },
  url = `http://127.0.0.1:3100/ACORN/apps/chat/${input.endpointId}/access`;
it("admits only the finite same-person same-endpoint Access UI", () => {
  expect(validSlackIdentityInput(spaceId, input, url)).toBe(true);
  for (const bad of [
    url + "?next=/admin",
    url.replace("/access", "/other"),
    url + "#other",
    url.replace(input.endpointId, spaceId),
  ])
    expect(validSlackIdentityInput(spaceId, input, bad)).toBe(false);
  expect(
    validSlackIdentityInput(spaceId, { ...input, principalId: "wrong" }, url),
  ).toBe(false);
  expect(
    validSlackIdentityInput(
      spaceId,
      { ...input, externalDetail: "@someone\nelse" },
      url,
    ),
  ).toBe(false);
});
it("requires actual preview space, endpoint, Slack provider and independently resolved external identity", () => {
  const value = {
    spaceId,
    endpointId: input.endpointId,
    provider: "slack",
    externalDetail: input.externalDetail,
    canConfirm: true,
  };
  expect(matchingSlackIdentityPreview(value, spaceId, input)).toBe(true);
  for (const wrong of [
    { ...value, spaceId: "other" },
    { ...value, endpointId: "other" },
    { ...value, provider: "discord" },
    { ...value, externalDetail: "@same.display.name" },
    { ...value, canConfirm: false },
  ])
    expect(matchingSlackIdentityPreview(wrong, spaceId, input)).toBe(false);
});

import { validSlackWizardIdentityInput } from "./external-slack-identity-contract.js";
it("restricts normal wizard continuation to the same real identity and exact saved Slack setup", () => {
  const setup = `http://127.0.0.1:3100/ACORN/apps/chat/connect?provider=slack&purpose=chat&resume=${input.endpointId}`;
  expect(validSlackWizardIdentityInput(spaceId, input, setup)).toBe(true);
  for (const wrong of [
    setup + "&stage=test",
    setup.replace(input.endpointId, spaceId),
    setup.replace("slack", "discord"),
    setup + "#test",
  ])
    expect(validSlackWizardIdentityInput(spaceId, input, wrong)).toBe(false);
});
