import { type Amount, assetRefSchema } from "@binference/chain";
import { err, type Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import {
  expectOk,
  testAgent,
  testCoin,
  testSwap,
  testToken,
  testWallet,
} from "../intents/test-intents.js";
import type { AgentStore } from "../ports.js";
import { startTestEngine, testCall } from "./test-engine.js";

const live = { signal: new AbortController().signal };
const otherWallet = "wal_0190f1c2-3a4b-7c5d-8e6f-000000000002" as Id<"wal">;
const unknownAgent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000009" as Id<"agt">;
const unlisted = assetRefSchema.parse("fake:1/token:0x00000bad");
// The test price: 600 micro-dollars for 10^12 base units of the coin, $600 a whole coin.
const coin = (base: bigint) => ({ asset: testCoin, base });
const named = (balances: readonly Amount[]) => testCall({ agent: testAgent, balances });

// An agent store that reads every agent back as archived.
function archivedAgents(store: AgentStore): AgentStore {
  return {
    ...store,
    async get(id, options) {
      const settings = await store.get(id, options);
      return settings === undefined
        ? undefined
        : { ...settings, agent: { ...settings.agent, archivedAtMs: 1 } };
    },
  };
}

describe("the paper portfolio reset", () => {
  it("starts again from the starting balances and answers the new portfolio", async () => {
    const test = await startTestEngine();
    const { handlers } = test.engine;
    const view = expectOk(await handlers["intent/propose"](testCall(testSwap())));
    const card = view.card?.card as Id<"crd">;
    await handlers["intent/confirm"](testCall({ intent: view.intent, card, cardVersion: 1 }));
    const reset = expectOk(await handlers["portfolio/resetPaper"](testCall({ agent: testAgent })));
    expect(reset).toStrictEqual({
      balances: [
        { wallet: testWallet, amount: coin(10n ** 18n), usdMicros: 600_000_000n, paper: true },
      ],
      positions: [
        {
          wallet: testWallet,
          asset: testCoin,
          quantity: 10n ** 18n,
          costUsdMicros: 600_000_000n,
          realizedUsdMicros: 0n,
          unrealizedUsdMicros: 0n,
          paper: true,
        },
      ],
      totalUsdMicros: 600_000_000n,
      assets: { [testCoin]: { symbol: "FAKE", name: "Fake", decimals: 18, verified: true } },
    });
    const held = await test.positions.positions({ walletId: testWallet, isPaper: true }, live);
    expect(held.map((row) => [row.asset, row.quantityBase, row.realizedUsdMicros])).toStrictEqual([
      [testCoin, 10n ** 18n, 0n],
      [testToken, 0n, 0n],
    ]);
  });

  it("opens named balances in the first wallet and empties the others", async () => {
    const test = await startTestEngine({ wallets: [testWallet, otherWallet] });
    const { handlers } = test.engine;
    const args = { agent: testAgent, balances: [coin(2n * 10n ** 18n)] };
    const reset = expectOk(await handlers["portfolio/resetPaper"](testCall(args)));
    expect(reset.balances).toStrictEqual([
      { wallet: testWallet, amount: coin(2n * 10n ** 18n), usdMicros: 1_200_000_000n, paper: true },
    ]);
    expect(reset.totalUsdMicros).toBe(1_200_000_000n);
    expect(
      await test.positions.positions({ walletId: otherWallet, isPaper: true }, live),
    ).toStrictEqual([]);
  });

  it("never changes the agent's mode or a live position", async () => {
    const test = await startTestEngine({ agent: { mode: "live" } });
    await test.engine.handlers["portfolio/resetPaper"](testCall({ agent: testAgent }));
    const agent = await test.stores.agents.get(testAgent, live);
    const livePositions = await test.positions.positions(
      { walletId: testWallet, isPaper: false },
      live,
    );
    expect([agent?.agent.mode, livePositions]).toStrictEqual(["live", []]);
  });

  it("refuses what it cannot start from, and changes nothing", async () => {
    const test = await startTestEngine();
    const reset = test.engine.handlers["portfolio/resetPaper"];
    expect([
      await reset(testCall({ agent: unknownAgent })),
      await reset(named([coin(1n), coin(2n)])),
      await reset(named([coin(0n)])),
      await reset(named([{ asset: unlisted, base: 1n }])),
      await reset(named([coin(1n), { asset: testToken, base: 1n }])),
    ]).toStrictEqual([
      err("agent.not_found"),
      err("protocol.bad_args"),
      err("protocol.bad_args"),
      err("asset.not_found"),
      err("chain.rpc_down"),
    ]);
    const held = await test.positions.positions({ walletId: testWallet, isPaper: true }, live);
    expect(held.map((row) => [row.asset, row.quantityBase])).toStrictEqual([
      [testCoin, 10n ** 18n],
    ]);
  });

  it("refuses an agent with no wallet, or an archived one", async () => {
    const lonely = await startTestEngine({ wallets: [], paper: [] });
    const archived = await startTestEngine({ agents: archivedAgents, paper: [] });
    const args = testCall({ agent: testAgent });
    expect([
      await lonely.engine.handlers["portfolio/resetPaper"](args),
      await archived.engine.handlers["portfolio/resetPaper"](args),
    ]).toStrictEqual([err("wallet.not_found"), err("agent.archived")]);
  });
});
