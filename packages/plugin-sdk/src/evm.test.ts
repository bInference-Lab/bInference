import { accountRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { decodeEvmDraft, encodeEvmDraft, parseEvmAddress } from "./evm.js";

const sender = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const router = "0x10ED43C718714eb63d5aA57B78B54704E256024E";

describe("evm helpers", () => {
  it("give a venue the EVM family's draft encoding", () => {
    const draft = encodeEvmDraft({
      from: accountRefSchema.parse(`eip155:56:${sender}`),
      to: accountRefSchema.parse(`eip155:56:${router.toLowerCase()}`),
      value: 5n,
      data: "0x7ff36ab5",
    });
    expect(decodeEvmDraft(draft)).toStrictEqual({
      ok: true,
      value: { from: sender, to: router, value: 5n, data: "0x7ff36ab5" },
    });
    expect(parseEvmAddress(router.toLowerCase())).toStrictEqual({ ok: true, value: router });
  });
});
