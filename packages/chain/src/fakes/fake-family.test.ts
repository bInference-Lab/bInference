import { describe, expect, it } from "vitest";
import { accountRefSchema } from "../caip/account-ref.js";
import { assetRefSchema } from "../caip/asset-ref.js";
import { chainFamilyContract } from "../contracts/chain-family-contract.js";
import { fakeApprovalData, fakeDraft } from "./fake-draft.js";
import { createFakeFamily } from "./fake-family.js";

const wallet = accountRefSchema.parse("fake:1:0x0000000c");
const router = accountRefSchema.parse("fake:1:0x0000000b");
const token = assetRefSchema.parse("fake:1/token:0x0000000a");
const swap = fakeDraft(wallet, { to: "0x0000000b", value: 0n, data: "swap" });

describe("fake family", () => {
  it.each(
    chainFamilyContract({
      create: () => ({
        family: createFakeFamily(),
        addresses: [
          { text: "0x0000000A", canonical: "0x0000000a" },
          { text: "0xabcdef12", canonical: "0xabcdef12" },
        ],
        malformed: ["", "0x123", "0xzzzzzzzz", "0x0000000a0"],
        drafts: [
          {
            draft: fakeDraft(wallet, { to: "0x0000000B", value: 7n, data: "swap" }),
            call: { target: router, nativeValue: 7n },
          },
          {
            draft: fakeDraft(wallet, {
              to: "0x0000000a",
              value: 0n,
              data: fakeApprovalData("0x0000000B", 5n),
            }),
            call: {
              target: accountRefSchema.parse("fake:1:0x0000000a"),
              nativeValue: 0n,
              approval: { asset: token, spender: router, amountBase: 5n },
            },
          },
        ],
        unreadable: [
          { ...swap, payload: "x" },
          { ...swap, payload: "0x0000000b|-1|swap" },
          { ...swap, payload: "0x0000000b|1|swap|more" },
          fakeDraft(wallet, { to: "0x0000000a", value: 0n, data: "approve,0x0000000b" }),
          fakeDraft(wallet, { to: "0x0000000a", value: 0n, data: "approve,nobody,5" }),
          fakeDraft(wallet, { to: "0x0000000a", value: 0n, data: "approve,0x0000000b,5,6" }),
        ],
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("refuses a draft of another family's chain", () => {
    const draft = fakeDraft(accountRefSchema.parse("other:1:0x0000000c"), {
      to: "0x0000000b",
      value: 0n,
      data: "swap",
    });
    expect(createFakeFamily().readDraft(draft)).toStrictEqual({
      ok: false,
      error: "malformed_draft",
    });
  });
});
