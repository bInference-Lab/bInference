import { accountRefSchema } from "@binference/chain";
import * as fc from "fast-check";
import { getAddress, type Hex, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { decodeEvmDraft, type EvmCallRequest, encodeEvmDraft } from "./evm-draft.js";

const sender = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const from = accountRefSchema.parse(`eip155:56:${sender}`);
const router = accountRefSchema.parse("eip155:56:0x10ED43C718714eb63d5aA57B78B54704E256024E");
const transfer: EvmCallRequest = { from, to: router, value: 1n, data: "0x" };

describe("evm drafts", () => {
  it("round-trips every call through its payload", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 20, maxLength: 20 }),
        fc.bigInt({ min: 0n, max: 2n ** 256n - 1n }),
        fc.uint8Array({ maxLength: 200 }),
        (toBytes, value, dataBytes) => {
          const to = getAddress(toHex(toBytes));
          const data: Hex = toHex(dataBytes);
          const draft = encodeEvmDraft({
            from,
            to: accountRefSchema.parse(`eip155:56:${to}`),
            value,
            data,
          });
          expect(draft.chain).toBe("eip155:56");
          expect(decodeEvmDraft(draft)).toStrictEqual({
            ok: true,
            value: { from: sender, to, value, data },
          });
        },
      ),
    );
  });

  it("reads a payload in upper case as the same call", () => {
    const draft = encodeEvmDraft({ ...transfer, data: "0xabcdef" });
    const upper = { ...draft, payload: `0x${draft.payload.slice(2).toUpperCase()}` };
    expect(decodeEvmDraft(upper)).toStrictEqual(decodeEvmDraft(draft));
  });

  it.each<[string, EvmCallRequest]>([
    [
      "a contract on another chain",
      { ...transfer, to: accountRefSchema.parse(`eip155:1:${sender}`) },
    ],
    [
      "a sender outside the EVM family",
      { ...transfer, from: accountRefSchema.parse("fake:1:0x0a") },
    ],
    [
      "a contract that is no address",
      { ...transfer, to: accountRefSchema.parse("eip155:56:0x0a") },
    ],
    ["a negative value", { ...transfer, value: -1n }],
    ["a value above 2^256 - 1", { ...transfer, value: 2n ** 256n }],
    ["calldata that is not hex bytes", { ...transfer, data: "0xabc" }],
  ])("refuses to encode %s", (_case, call) => {
    expect(() => encodeEvmDraft(call)).toThrow(
      expect.objectContaining({ code: "chain.bad_draft" }),
    );
  });
});
