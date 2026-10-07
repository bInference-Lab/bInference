import { describe, expect, it } from "vitest";
import { accountRefSchema } from "./caip/account-ref.js";
import { createFakeFamily } from "./fakes/fake-family.js";
import { isSameAccount } from "./same-account.js";

const family = createFakeFamily();
const account = (text: string) => accountRefSchema.parse(text);

describe("isSameAccount", () => {
  it("matches one address in any letter case on one chain", () => {
    expect(isSameAccount(account("fake:1:0x0000000a"), account("fake:1:0x0000000A"), family)).toBe(
      true,
    );
  });

  it.each([
    ["another address", "fake:1:0x0000000a", "fake:1:0x0000000b"],
    ["the same address on another chain", "fake:1:0x0000000a", "fake:2:0x0000000a"],
    ["an address the family cannot read", "fake:1:0x0000000a", "fake:1:not-an-address"],
    ["two addresses the family cannot read", "fake:1:not-an-address", "fake:1:not-an-address"],
  ])("tells %s apart", (_name, left, right) => {
    expect(isSameAccount(account(left), account(right), family)).toBe(false);
  });
});
