import { accountRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { encodeEvmApproval } from "./evm-approval.js";
import { decodeEvmDraft } from "./evm-draft.js";

const wallet = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const usdt = "0x55d398326f99059fF775485246999027B3197955";
const router = "0x10ED43C718714eb63d5aA57B78B54704E256024E";

describe("evm approval", () => {
  it("approves exactly the amount for the spender, from the wallet to the token", () => {
    const draft = encodeEvmApproval({
      wallet: accountRefSchema.parse(`eip155:56:${wallet}`),
      token: usdt,
      spender: router,
      amountBase: 5n,
    });
    expect(decodeEvmDraft(draft)).toStrictEqual({
      ok: true,
      value: {
        from: wallet,
        to: usdt,
        value: 0n,
        data: `0x095ea7b3${router.slice(2).toLowerCase().padStart(64, "0")}${"5".padStart(64, "0")}`,
      },
    });
  });
});
