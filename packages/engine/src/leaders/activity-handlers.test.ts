import { accountRefSchema, chainRefSchema, isTxHash, type TxHash } from "@binference/chain";
import { bpsSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { expectOk, testAgent, testCoin, testToken, testWallet } from "../intents/test-intents.js";
import { startTestEngine, type TestEngine, testCall } from "../operations/test-engine.js";
import type { WalletActivity } from "./tracked-wallet-record.js";

const chain = chainRefSchema.parse("fake:1");
const leader = accountRefSchema.parse("fake:1:0x0000000d");
const stranger = accountRefSchema.parse("fake:1:0x0000000e");

function txOf(n: number): TxHash {
  const hash = `0x${n.toString(16).padStart(64, "0")}`;
  if (!isTxHash(hash)) {
    throw new Error("Not a hash.");
  }
  return hash;
}

// A sale of the leader at block `n`, made at `n` seconds.
function saleAt(n: number): WalletActivity {
  return {
    account: leader,
    block: BigInt(n),
    txHash: txOf(n),
    logIndex: 0,
    side: "sell",
    asset: testToken,
    amount: 2n ** 64n + 1n,
    counterAsset: testCoin,
    counterAmount: 5n,
    shareSoldBps: bpsSchema.parse(4_000),
    venue: "fake-swap",
    valueUsdMicros: 9n,
    atMs: n * 1_000,
  };
}

// The engine with a wallet alert of the test agent on the leader, and the leader's trades stored.
async function trackedLeader(blocks: readonly number[]): Promise<TestEngine> {
  const test = await startTestEngine();
  const condition = { kind: "wallet", account: leader } as const;
  expectOk(await test.engine.handlers["alert/create"](testCall({ agent: testAgent, condition })));
  const read = {
    chain,
    from: 1n,
    to: 9n,
    toHash: "0x09",
    atMs: 9_000,
    wallets: [{ account: leader, sinceBlock: 1n, readFrom: 1n }],
    trades: blocks.map(saleAt),
    overflows: [],
  };
  await test.stores.trackedWallets.record(read, testCall({}));
  return test;
}

const activity = async (test: TestEngine, args: object) =>
  test.engine.handlers["wallet/activity"](testCall({ agent: testAgent, account: leader, ...args }));

describe("wallet/activity", () => {
  it("answers a tracked wallet's trades newest first, with the next page's cursor", async () => {
    const test = await trackedLeader([2, 3, 4]);
    const first = expectOk(await activity(test, { limit: 2 }));
    expect(first.items.map(({ block }) => block)).toStrictEqual([4, 3]);
    expect(first.items[0]).toStrictEqual({
      at: 4_000,
      block: 4,
      tx: txOf(4),
      side: "sell",
      asset: testToken,
      amount: 2n ** 64n + 1n,
      counterAsset: testCoin,
      counterAmount: 5n,
      valueUsdMicros: 9n,
      shareSoldBps: 4_000,
      venue: "fake-swap",
    });
    expect(Object.keys(first.assets).toSorted()).toStrictEqual([testCoin, testToken].toSorted());
    const rest = expectOk(await activity(test, { limit: 2, cursor: first.next }));
    expect([rest.items.map(({ block }) => block), rest.next]).toStrictEqual([[2], undefined]);
  });

  it("answers a buy with no share, value or venue as the watcher stored it", async () => {
    const test = await trackedLeader([]);
    const { shareSoldBps: _share, venue: _venue, valueUsdMicros: _value, ...sale } = saleAt(5);
    const buy = { ...sale, side: "buy" } as const;
    const read = {
      chain,
      from: 5n,
      to: 5n,
      toHash: "0x05",
      atMs: 5_000,
      trades: [buy],
      overflows: [],
    };
    const wallets = [{ account: leader, sinceBlock: 1n, readFrom: 5n }];
    await test.stores.trackedWallets.record({ ...read, wallets }, testCall({}));
    const [item] = expectOk(await activity(test, {})).items;
    expect(item).toStrictEqual({
      at: 5_000,
      block: 5,
      tx: txOf(5),
      side: "buy",
      asset: testToken,
      amount: 2n ** 64n + 1n,
      counterAsset: testCoin,
      counterAmount: 5n,
    });
  });

  it("answers the trades of a range of time", async () => {
    const test = await trackedLeader([2, 3, 4]);
    const ranged = expectOk(await activity(test, { from: 3_000, to: 3_000 }));
    expect(ranged.items.map(({ block }) => block)).toStrictEqual([3]);
  });

  it("refuses an account the agent does not track, a bad cursor, and an unknown agent", async () => {
    const test = await trackedLeader([2]);
    expect(await activity(test, { account: stranger })).toStrictEqual({
      ok: false,
      error: "wallet.not_found",
    });
    expect(await activity(test, { cursor: "later" })).toStrictEqual({
      ok: false,
      error: "protocol.bad_args",
    });
    expect(await activity(test, { agent: fixtureId("agt", 77) })).toStrictEqual({
      ok: false,
      error: "agent.not_found",
    });
  });

  it("answers a copy order's leader while the order awaits its card", async () => {
    const test = await startTestEngine();
    const at = test.clock.now();
    const stored = testWalletRecord({
      id: testWallet,
      agentId: testAgent,
      label: "main",
      createdAtMs: at,
    });
    test.stores.install.addWallet({ ...stored, address: "0x0000000c" });
    const request = {
      kind: "copy",
      agent: testAgent,
      wallet: testWallet,
      token: testToken,
      side: "buy",
      size: { base: 1n },
      trigger: { leader, perBuyUsdMicros: 1n, dailyUsdMicros: 2n },
    } as const;
    const draft = {
      id: fixtureId("ord", 1),
      agentId: testAgent,
      walletId: testWallet,
      request,
      expiresAtMs: test.clock.now() + 1_000,
      intentId: fixtureId("int", 1),
      isPaper: true,
      hasOutsideContent: false,
      atMs: test.clock.now(),
    };
    expectOk(await test.stores.orders.create(draft, testCall({})));
    expect(expectOk(await activity(test, {})).items).toStrictEqual([]);
  });
});
