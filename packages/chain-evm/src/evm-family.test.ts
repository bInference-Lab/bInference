import { accountRefSchema, assetRefSchema, chainRefSchema, type TxDraft } from "@binference/chain";
import { chainFamilyContract } from "@binference/chain/testing";
import * as fc from "fast-check";
import { encodeFunctionData, erc20Abi, getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { encodeEvmDraft } from "./drafts/evm-draft.js";
import { parseEvmAddress } from "./evm-address.js";
import { createEvmFamily } from "./evm-family.js";

const checksummed = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const wallet = accountRefSchema.parse(`eip155:56:${checksummed}`);
const router = accountRefSchema.parse("eip155:56:0x10ED43C718714eb63d5aA57B78B54704E256024E");
const usdt = "0x55d398326f99059fF775485246999027B3197955";
const usdtAccount = accountRefSchema.parse(`eip155:56:${usdt}`);
const swap = encodeEvmDraft({ from: wallet, to: router, value: 10n ** 17n, data: "0x7ff36ab5" });
const approve = encodeEvmDraft({
  from: wallet,
  to: usdtAccount,
  value: 0n,
  data: encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: ["0x10ED43C718714eb63d5aA57B78B54704E256024E", 5n],
  }),
});

function withPayload(draft: TxDraft, payload: string): TxDraft {
  return { ...draft, payload };
}

describe("evm family", () => {
  it.each(
    chainFamilyContract({
      create: () => ({
        family: createEvmFamily(),
        addresses: [
          { text: checksummed.toLowerCase(), canonical: checksummed },
          { text: `0x${checksummed.slice(2).toUpperCase()}`, canonical: checksummed },
          { text: checksummed, canonical: checksummed },
        ],
        malformed: [
          "",
          "0x",
          "5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
          "0X5aaeb6053f3e94c9b9a09f33669435e7ef1beaed",
          "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beae",
          "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaedd",
          "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beazz",
          "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD",
        ],
        drafts: [
          { draft: swap, call: { target: router, nativeValue: 10n ** 17n } },
          {
            draft: approve,
            call: {
              target: usdtAccount,
              nativeValue: 0n,
              approval: {
                asset: assetRefSchema.parse(`eip155:56/erc20:${usdt}`),
                spender: router,
                amountBase: 5n,
              },
            },
          },
        ],
        unreadable: [
          withPayload(swap, "0x"),
          withPayload(swap, swap.payload.slice(0, 100)),
          withPayload(swap, `${swap.payload}0`),
          withPayload(swap, swap.payload.replace("0x", "0y")),
          withPayload(approve, approve.payload.slice(0, -2)),
          { ...swap, from: accountRefSchema.parse("eip155:56:not-an-address") },
          { ...swap, chain: chainRefSchema.parse("eip155:1") },
          {
            chain: chainRefSchema.parse("fake:1"),
            from: accountRefSchema.parse("fake:1:0x0000000c"),
            payload: swap.payload,
          },
        ],
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("gives every 20-byte address one canonical form whatever its case", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 20, maxLength: 20 }), (bytes) => {
        const lower = `0x${Buffer.from(bytes).toString("hex")}`;
        const canonical = getAddress(lower);
        expect(parseEvmAddress(lower)).toStrictEqual({ ok: true, value: canonical });
        expect(parseEvmAddress(`0x${lower.slice(2).toUpperCase()}`)).toStrictEqual({
          ok: true,
          value: canonical,
        });
        expect(parseEvmAddress(canonical)).toStrictEqual({ ok: true, value: canonical });
      }),
    );
  });
});
