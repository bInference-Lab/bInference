import { type AssetRef, assetRefSchema, chainRefSchema } from "@binference/chain";
import { err } from "@binference/core";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createMemoryAgentStore } from "../fakes/memory-agent-store.js";
import { createMemoryInstallStore } from "../fakes/memory-install-store.js";
import { createMemoryPositionStore } from "../fakes/memory-position-store.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { expectOk, testAgent, testAgentDraft, testNowMs } from "../intents/test-intents.js";
import type { PositionRecord } from "../positions/position-record.js";
import { createAssetSearchHandlers } from "./asset-search-handlers.js";
import { testCall, testChains } from "./test-engine.js";

const other = fixtureId("agt", 61);
const mine = testWalletRecord({
  id: fixtureId("wal", 61),
  agentId: testAgent,
  label: "Mine",
  createdAtMs: 1,
});
const theirs = testWalletRecord({
  id: fixtureId("wal", 62),
  agentId: other,
  label: "Theirs",
  createdAtMs: 2,
});
const paperToken = assetRefSchema.parse("fake:1/token:0x000000d1");
const theirToken = assetRefSchema.parse("fake:1/token:0x000000d2");
const soldToken = assetRefSchema.parse("fake:1/token:0x000000d3");

function position(walletId: PositionRecord["walletId"], asset: AssetRef, quantityBase: bigint) {
  return {
    walletId,
    asset,
    isPaper: true,
    quantityBase,
    costUsdMicros: 0n,
    realizedUsdMicros: 0n,
    changedAtMs: testNowMs,
    version: 0,
  };
}

const stored: readonly PositionRecord[] = [
  position(mine.id, paperToken, 5n),
  position(mine.id, soldToken, 0n),
  position(theirs.id, theirToken, 7n),
];

async function assetSearch() {
  const agents = createMemoryAgentStore();
  await agents.create(testAgentDraft(), testCall({}));
  await agents.create(testAgentDraft({ id: other, name: "other" }), testCall({}));
  const install = createMemoryInstallStore();
  [mine, theirs].forEach((wallet) => install.addWallet(wallet));
  const store = {
    ...createMemoryPositionStore(),
    positions: async (query: { readonly walletId: string; readonly isPaper: boolean }) =>
      Promise.resolve(
        stored.filter((held) => held.walletId === query.walletId && held.isPaper === query.isPaper),
      ),
  };
  const handlers = createAssetSearchHandlers({ agents, install, store, chains: testChains() });
  return handlers["asset/search"];
}

const chain = chainRefSchema.parse("fake:1");

describe("the asset search handler", () => {
  it("marks an address the agent's wallets hold some of, and not one they sold", async () => {
    const search = await assetSearch();
    const held = expectOk(await search(testCall({ chain, query: "0x000000d1", agent: testAgent })));
    expect(held.unlisted).toStrictEqual([{ asset: paperToken, held: true }]);
    const sold = expectOk(await search(testCall({ chain, query: "0x000000d3", agent: testAgent })));
    expect(sold.unlisted).toStrictEqual([{ asset: soldToken, held: false }]);
  });

  it("counts only the named agent's wallets, and every agent's when it names none", async () => {
    const search = await assetSearch();
    const query = { chain, query: "0x000000d2" };
    const named = expectOk(await search(testCall({ ...query, agent: testAgent })));
    expect(named.unlisted).toStrictEqual([{ asset: theirToken, held: false }]);
    const every = expectOk(await search(testCall(query)));
    expect(every.unlisted).toStrictEqual([{ asset: theirToken, held: true }]);
  });

  it("refuses a chain the registry does not hold and an agent it does not know", async () => {
    const search = await assetSearch();
    await expect(
      search(testCall({ chain: chainRefSchema.parse("fake:9"), query: "TKN" })),
    ).resolves.toStrictEqual(err("protocol.bad_args"));
    await expect(
      search(testCall({ chain, query: "TKN", agent: fixtureId("agt", 69) })),
    ).resolves.toStrictEqual(err("agent.not_found"));
  });
});
