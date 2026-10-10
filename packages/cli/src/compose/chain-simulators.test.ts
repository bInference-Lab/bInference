import { accountRefSchema, assetRefSchema, chainRefSchema } from "@binference/chain";
import { createFakeTxSimulator, fakeDraft, txSimulatorContract } from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { txSimulatorRouterOf } from "./chain-simulators.js";

const wallet = accountRefSchema.parse("fake:1:0x0000000c");
const router = accountRefSchema.parse("fake:1:0x0000000b");
const coin = assetRefSchema.parse("fake:1/slip44:1");
const reflecting = assetRefSchema.parse("fake:1/token:0x0000000f");
const pay = fakeDraft(wallet, { to: "0x0000000b", value: 5n, data: "pay" });
const broken = fakeDraft(wallet, { to: "0x0000000b", value: 0n, data: "broken" });
const payMore = fakeDraft(wallet, { to: "0x0000000b", value: 10n, data: "pay more" });
const transfer = { from: wallet, to: router, amount: { asset: coin, base: 5n } };
const paid = { status: "success", gasUsed: 21_000n, transfers: [transfer], approvals: [] } as const;
const live = { signal: new AbortController().signal };

function routed() {
  const simulator = createFakeTxSimulator(
    new Map([
      [pay.payload, paid],
      [payMore.payload, paid],
    ]),
    new Map([[payMore.payload, { asset: coin, base: 10n }]]),
    new Set([reflecting]),
  );
  return txSimulatorRouterOf(new Map([[chainRefSchema.parse("fake:1"), simulator]]));
}

describe("the self-hosted transaction simulator", () => {
  it.each(
    txSimulatorContract({
      create: () => ({
        simulator: routed(),
        moving: { drafts: [pay], transfer },
        reverting: [pay, broken],
        unfunded: { drafts: [pay, payMore], balance: { asset: coin, base: 10n } },
        unsettable: { drafts: [pay], balance: { asset: reflecting, base: 1n } },
      }),
    }),
  )("routes drafts to their chain's simulator: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("runs no drafts as nothing, and refuses drafts of a chain it has no simulator for", async () => {
    await expect(routed().simulate([], live)).resolves.toStrictEqual([]);
    const stranger = accountRefSchema.parse("fake:2:0x0000000c");
    const elsewhere = fakeDraft(stranger, { to: "0x0000000b", value: 5n, data: "pay" });
    await expect(routed().simulate([elsewhere], live)).rejects.toMatchObject({
      code: "cli.no_chain_parts",
    });
  });
});
