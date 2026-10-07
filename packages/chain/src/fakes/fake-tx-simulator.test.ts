import { describe, expect, it } from "vitest";
import { accountRefSchema } from "../caip/account-ref.js";
import { assetRefSchema } from "../caip/asset-ref.js";
import { txSimulatorContract } from "../contracts/tx-simulator-contract.js";
import { fakeDraft } from "./fake-draft.js";
import { createFakeTxSimulator } from "./fake-tx-simulator.js";

const wallet = accountRefSchema.parse("fake:1:0x0000000c");
const router = accountRefSchema.parse("fake:1:0x0000000b");
const coin = assetRefSchema.parse("fake:1/slip44:1");
const pay = fakeDraft(wallet, { to: "0x0000000b", value: 5n, data: "pay" });
const broken = fakeDraft(wallet, { to: "0x0000000b", value: 0n, data: "broken" });
const transfer = { from: wallet, to: router, amount: { asset: coin, base: 5n } };
const paid = { status: "success", gasUsed: 21_000n, transfers: [transfer], approvals: [] } as const;
const live = { signal: new AbortController().signal };
const payMore = fakeDraft(wallet, { to: "0x0000000b", value: 10n, data: "pay more" });
const needs = new Map([[payMore.payload, { asset: coin, base: 10n }]]);

describe("fake transaction simulator", () => {
  it.each(
    txSimulatorContract({
      create: () => ({
        simulator: createFakeTxSimulator(
          new Map([
            [pay.payload, paid],
            [payMore.payload, paid],
          ]),
          needs,
        ),
        moving: { drafts: [pay], transfer },
        reverting: [pay, broken],
        unfunded: { drafts: [pay, payMore], balance: { asset: coin, base: 10n } },
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("runs a draft that needs more than the chain holds only with the balances it is given", async () => {
    const simulator = createFakeTxSimulator(new Map([[payMore.payload, paid]]), needs);
    const short = { ...live, balances: [{ asset: coin, base: 9n }] };
    const enough = { ...live, balances: [{ asset: coin, base: 10n }] };
    await expect(simulator.simulate([payMore], short)).resolves.toStrictEqual([
      { status: "reverted", gasUsed: 0n, transfers: [], approvals: [] },
    ]);
    await expect(simulator.simulate([payMore], enough)).resolves.toStrictEqual([paid]);
  });

  it("answers each draft with the step the table holds for its payload, in order", async () => {
    const simulator = createFakeTxSimulator(new Map([[pay.payload, paid]]));
    await expect(simulator.simulate([broken, pay], live)).resolves.toStrictEqual([
      { status: "reverted", gasUsed: 0n, transfers: [], approvals: [] },
      paid,
    ]);
  });
});
