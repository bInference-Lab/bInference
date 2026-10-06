import type { AccountRef, AssetRef, ChainRef } from "@binference/chain";
import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { composeCloudTestRoot } from "./cloud-test-root.js";

const live = { signal: new AbortController().signal };
const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"agt">;
const wallet = "wal_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"wal">;
const account = "fake:1:0x0000000a" as AccountRef;
const coin = "fake:1/slip44:1" as AssetRef;
const price = { numerator: 600n, denominator: 10n ** 12n };

describe("cloud test root", () => {
  it("stores a relayed update in the inbox before it acknowledges it", async () => {
    const root = composeCloudTestRoot();
    const posted = { updateId: 7, payload: { update_id: 7 } };
    root.updates.deliver(posted);
    await expect(root.updates.next(live)).resolves.toStrictEqual([posted]);
    const admitted = await root.stores.inbox.admit(
      { source: "telegram", sourceKey: "tg:1:7", payload: posted.payload, receivedAtMs: 1 },
      live,
    );
    await root.updates.acknowledge(7, live);
    root.updates.deliver({ updateId: 8, payload: { update_id: 8 } });
    await expect(root.updates.next(live)).resolves.toStrictEqual([
      { updateId: 8, payload: { update_id: 8 } },
    ]);
    await expect(root.stores.inbox.unhandled(10, live)).resolves.toStrictEqual([admitted.entry]);
  });

  it("prices and streams from one shared market-data feed", async () => {
    const root = composeCloudTestRoot();
    const watching = new AbortController();
    const stream = root.market.prices(coin, { signal: watching.signal })[Symbol.asyncIterator]();
    root.prices.publishPrice({ asset: coin, price, atMs: 1 });
    await expect(stream.next()).resolves.toStrictEqual({
      done: false,
      value: { asset: coin, price, atMs: 1 },
    });
    await expect(root.prices.usdPrice(coin, live)).resolves.toStrictEqual({
      ok: true,
      value: price,
    });
    watching.abort();
    expect(root.market.subscriptions()).toBe(0);
  });

  it("starts from the wallets and credit it is given, and nothing else", async () => {
    const root = composeCloudTestRoot({
      wallets: new Map([[wallet, account]]),
      credits: [{ credit: 5_000_000n, agents: [agent] }],
    });
    const empty = composeCloudTestRoot();
    await expect(root.custody.account(wallet, "fake:1" as ChainRef, live)).resolves.toStrictEqual({
      ok: true,
      value: account,
    });
    await expect(root.billing.left(agent, live)).resolves.toBe(5_000_000n);
    await expect(empty.billing.left(agent, live)).resolves.toBe(0n);
    await expect(empty.secrets.read("telegram-bot", live.signal)).resolves.toStrictEqual({
      ok: false,
      error: "not_found",
    });
  });
});
