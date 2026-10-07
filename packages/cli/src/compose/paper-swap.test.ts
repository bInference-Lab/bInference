import type { ProtocolClient } from "@binference/client";
import type { Id } from "@binference/core";
import { walkLedgerChain } from "@binference/engine";
import {
  testAgent as agent,
  testCoin as coin,
  testNowMs as nowMs,
  testToken as token,
  testWallet as wallet,
} from "@binference/engine/testing";
import type { PushFrame } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import {
  type Skeleton,
  skeletonCompositions as compositions,
  skeletonSecrets,
  startSkeleton,
} from "./test-skeleton.js";

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });

const swapRequest = {
  kind: "swap" as const,
  agent,
  wallet,
  reason: "Rotate into the token",
  from: coin,
  to: token,
  amount: { base: 1_000_000n },
};

const unsettled = (): void => undefined;

/** A promise and the call that resolves it. */
function deferred<T>() {
  let settle: (value: T) => void = unsettled;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: (value: T) => settle(value) };
}

/** Collects a topic's pushes and resolves once `count` arrived. */
function collect(client: ProtocolClient, topic: "intent" | "ledger", count: number) {
  const pushes: PushFrame[] = [];
  const all = deferred<readonly PushFrame[]>();
  const ready = deferred<undefined>();
  client.subscribe(topic, {
    onPush: (push) => {
      pushes.push(push);
      if (pushes.length === count) {
        all.resolve([...pushes]);
      }
    },
    refetch: async () => ready.resolve(undefined),
  });
  return { all: all.promise, ready: ready.promise };
}

describe.each(compositions)(
  "a paper swap through every layer on the $name composition",
  ({ parts }) => {
    let skeleton: Skeleton | undefined;

    afterEach(async () => {
      await skeleton?.close();
      skeleton = undefined;
    });

    it(
      "proposes, opens a card, confirms, fills at the quote and appends the ledger",
      {
        timeout: 60_000,
      },
      async () => {
        skeleton = await startSkeleton(parts());
        const { client } = skeleton;
        const intents = collect(client, "intent", 10);
        const ledger = collect(client, "ledger", 4);
        await Promise.all([intents.ready, ledger.ready]);
        const opened = await client.call("portfolio/resetPaper", { agent }, live());
        expect(opened.balances).toStrictEqual([
          {
            wallet,
            amount: { asset: coin, base: 10n ** 18n },
            usdMicros: 600_000_000n,
            paper: true,
          },
        ]);

        const proposed = await client.call("intent/propose", swapRequest, live());
        expect(proposed).toMatchObject({
          state: "awaiting_confirmation",
          paper: true,
          quote: {
            amountIn: { asset: coin, base: 1_000_000n },
            expectedOut: { asset: token, base: 2_000_000n },
            minOut: { asset: token, base: 1_990_000n },
            quotedAt: nowMs,
          },
          card: { version: 1, opensAt: nowMs, expiresAt: nowMs + 60_000, paper: true },
          assets: { [coin]: { symbol: "FAKE" }, [token]: { symbol: "TKN" } },
        });
        const card = proposed.card?.card as Id<"crd">;

        const confirmed = await client.call(
          "intent/confirm",
          { intent: proposed.intent, card, cardVersion: 1 },
          live(),
        );
        expect(confirmed.state).toBe("paper_filled");
        expect(confirmed.outcome?.executions).toStrictEqual([
          {
            amountIn: { asset: coin, base: 1_000_000n },
            amountOut: { asset: token, base: 2_000_000n },
            at: nowMs,
          },
        ]);

        const intentPushes = await intents.all;
        expect(intentPushes.map((push) => [push.seq, push.kind])).toStrictEqual([
          [1, "intent/created"],
          [2, "intent/changed"],
          [3, "intent/changed"],
          [4, "intent/changed"],
          [5, "intent/changed"],
          [6, "intent/changed"],
          [7, "card/opened"],
          [8, "intent/changed"],
          [9, "card/closed"],
          [10, "intent/changed"],
        ]);
        expect(intentPushes[6]?.data).toMatchObject({ intent: proposed.intent, card, version: 1 });
        expect(intentPushes[8]?.data).toMatchObject({ card, reason: "confirmed" });

        const ledgerPushes = await ledger.all;
        expect(ledgerPushes.map((push) => [push.seq, push.kind])).toStrictEqual([
          [1, "ledger/appended"],
          [2, "ledger/appended"],
          [3, "ledger/appended"],
          [4, "ledger/appended"],
        ]);
        const listed = await client.call("ledger/list", {}, live());
        expect(listed.items.map((entry) => [entry.kind, entry.subject])).toStrictEqual([
          ["proposed", proposed.intent],
          ["awaiting_confirmation", proposed.intent],
          ["confirmed", proposed.intent],
          ["paper_filled", proposed.intent],
        ]);
        expect(ledgerPushes.map((push) => push.data)).toStrictEqual(
          listed.items.map((item) => ({
            ...item,
          })),
        );
        expect(listed.items[3]?.data).toMatchObject({
          fill: {
            amountIn: { asset: coin, base: "1000000" },
            amountOut: { asset: token, base: "2000000" },
            atMs: nowMs,
          },
        });
        await expect(
          walkLedgerChain(skeleton.parts.stores.ledger, {}, live()),
        ).resolves.toMatchObject({ ok: true, value: { seq: 4 } });
        const held = await skeleton.positions.positions(
          { walletId: wallet, isPaper: true },
          live(),
        );
        expect(held.map((row) => [row.asset, row.quantityBase])).toStrictEqual([
          [coin, 10n ** 18n - 1_000_000n],
          [token, 2_000_000n],
        ]);
        expect(skeleton.executor.taken()).toStrictEqual([]);
      },
    );

    it(
      "goes live only on the owner's call, then hands a confirmed trade to the wallet queue",
      { timeout: 60_000 },
      async () => {
        skeleton = await startSkeleton(parts());
        const { client } = skeleton;
        const mcp = await skeleton.connect(skeletonSecrets.mcp, "mcp");
        await expect(mcp.call("agent/goLive", { agent }, live())).rejects.toMatchObject({
          code: "auth.scope",
        });
        const stored = await skeleton.parts.stores.agents.get(agent, live());
        expect(stored?.agent.mode).toBe("paper");
        expect((await client.call("agent/goLive", { agent }, live())).mode).toBe("live");

        const proposed = await client.call("intent/propose", swapRequest, live());
        expect([proposed.paper, proposed.card?.paper]).toStrictEqual([false, false]);
        const card = proposed.card?.card as Id<"crd">;
        const confirmed = await client.call(
          "intent/confirm",
          { intent: proposed.intent, card, cardVersion: 1 },
          live(),
        );
        expect(confirmed.state).toBe("confirmed");
        expect(skeleton.executor.taken()).toStrictEqual([proposed.intent]);
      },
    );
  },
);
