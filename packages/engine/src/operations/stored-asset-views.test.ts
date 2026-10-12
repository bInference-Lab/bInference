import { type AssetRef, assetRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { createFakeTokenFacts } from "../fakes/fake-token-facts.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { expectOk, testAgent, testToken, testWallet } from "../intents/test-intents.js";
import { createdOrder, testStopLoss } from "../orders/test-orders.js";
import { startTestEngine, testAccount, testCall, testCallers } from "./test-engine.js";

// Tokens the registry does not list: one an order's proposal read, one nothing ever read.
const xvs = assetRefSchema.parse("fake:1/token:0x0000000f");
const unread = assetRefSchema.parse("fake:1/token:0x00000bad");
const xvsInfo = { symbol: "XVS", name: "Venus", decimals: 18, verified: false };

const live = { signal: new AbortController().signal };

// Units of a token that arrived in the live test wallet, opening its position.
function arrivalOf(asset: AssetRef, base: bigint) {
  const position = {
    walletId: testWallet,
    asset,
    isPaper: false,
    quantityBase: base,
    costUsdMicros: 0n,
    realizedUsdMicros: 0n,
    changedAtMs: 1,
  };
  const arrival = { walletId: testWallet, isPaper: false, atMs: 1, received: { asset, base } };
  return { arrival, positions: [{ position }] };
}

// The test wallet holds both unlisted tokens on chain, and an order on XVS waits for its card.
async function heldEngine() {
  const facts = new Map([[xvs, { symbol: "XVS", name: "Venus", decimals: 18 }]]);
  const test = await startTestEngine({
    tokenFacts: createFakeTokenFacts({ facts }).read,
    held: new Map([
      [
        testAccount,
        [
          { asset: xvs, base: 5n * 10n ** 18n },
          { asset: unread, base: 7n },
        ],
      ],
    ]),
  });
  test.stores.install.addWallet({
    ...testWalletRecord({ id: testWallet, agentId: testAgent, label: "main", createdAtMs: 1 }),
    address: "0x0000000c",
  });
  await test.positions.recordArrival(arrivalOf(xvs, 5n * 10n ** 18n), live);
  await test.positions.recordArrival(arrivalOf(unread, 7n), live);
  await createdOrder(test, testStopLoss({ token: xvs }));
  return test;
}

describe("views that name unlisted tokens", () => {
  it("list an order on an unlisted token with what its proposal stored of it, unverified", async () => {
    const test = await heldEngine();
    await createdOrder(test, testStopLoss());
    const page = expectOk(await test.engine.handlers["order/list"](testCall({})));
    expect(page.assets?.[xvs]).toStrictEqual(xvsInfo);
    expect(page.assets?.[testToken]).toMatchObject({ verified: true });
  });

  it("show a held unlisted token by its stored info, and one nothing stored by its address", async () => {
    const test = await heldEngine();
    const view = expectOk(
      await test.engine.handlers["portfolio/get"](testCall({ agent: testAgent })),
    );
    const liveAssets = view.balances
      .filter(({ paper }) => !paper)
      .map(({ amount }) => amount.asset);
    expect(liveAssets).toContain(xvs);
    expect(liveAssets).toContain(unread);
    expect(view.assets[xvs]).toStrictEqual(xvsInfo);
    expect(view.assets).not.toHaveProperty(unread);
  });

  it("give the live facts the stored info of an order's unlisted token", async () => {
    const test = await heldEngine();
    const caller = testCallers.runtime;
    const facts = expectOk(
      await test.engine.handlers["facts/get"](testCall({ agent: testAgent }, caller)),
    );
    expect(facts.assets[xvs]).toStrictEqual(xvsInfo);
    expect(facts.assets).not.toHaveProperty(unread);
  });
});
