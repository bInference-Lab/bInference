import { setTimeout as wait } from "node:timers/promises";
import type { AssetRef } from "@binference/chain";
import { createRpcFailover, erc20AssetRef, evmAccountRef } from "@binference/chain-evm";
import { bscContract, bscToken, type Fork } from "@binference/chain-evm/fork";
import { BinferenceError, type Http } from "@binference/core";
import { createMemoryLogger } from "@binference/core/testing";
import { createVenueHost, type EnginePush } from "@binference/engine";
import type { StoredLaunch } from "@binference/engine/market";
import { createFlapVenue } from "@binference/flap";
import { createGeniusfunVenue } from "@binference/geniusfun";
import { successOf } from "@binference/plugin-sdk/testing";
import {
  type AlertFired,
  type LaunchFilter,
  type LaunchView,
  launchFilterSchema,
} from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createClosers } from "../compose/closers.js";
import { composeLaunchFeeds } from "../compose/launch-feeds.js";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import { createSystemClock } from "../runtime/system-clock.js";
import { flapSalts, launchOnFlap } from "./flap-launch.js";
import { launchOnGeniusfun } from "./geniusfun-launch.js";
import { cliCaller, fillAgent, type FillRig, onFillFork, xvs } from "./order-fill-rig.js";

// The launch feed on a BSC fork, reading the fork's own blocks: two tokens launched on Flap's
// Portal and two on Genius.fun's m4.2 stack by the fork's account, the second two while the feed's
// endpoint is down; then two on Flap and three on Genius.fun under a launch alert that wakes the
// agent. Nothing is reached but the fork.
const waitMs = 250;
const readTimeoutMs = 20_000;
const firstBuy = 10n ** 16n;

/** An endpoint to the fork that can go down, as a node in an outage does. */
interface Switchable {
  readonly http: Http;
  isDown: boolean;
}

function switchableOf(fork: Fork): Switchable {
  const switchable: Switchable = {
    isDown: false,
    http: {
      async request(request) {
        if (switchable.isDown) {
          throw new BinferenceError({
            code: "http.unreachable",
            message: "The node is down.",
            retryable: true,
          });
        }
        return fork.http.request(request);
      },
    },
  };
  return switchable;
}

// The launch feed of the fork's chain, composed as the engine composes it, over an endpoint that
// can go down, the rig's launch store and its engine's alerts.
function feedOn(
  fork: Fork,
  rig: FillRig,
  parts: { readonly endpoint: Switchable; readonly pushes: EnginePush[] },
) {
  const { endpoint, pushes } = parts;
  const chains = selfHostedChains();
  const chain = chains.list().find(({ ref }) => ref === fork.chain.ref);
  if (chain === undefined) {
    throw new BinferenceError({ code: "fork.no_chain", message: "The registry lacks the fork." });
  }
  const clock = createSystemClock();
  const rpc = createRpcFailover({
    endpoints: [{ name: "fork", url: fork.rpcUrl }],
    http: endpoint.http,
    clock,
    timeoutMs: 10_000,
    restMs: 50,
  });
  const quoteTokens = [bscToken("USDT"), bscToken("USDC")].map((token) =>
    erc20AssetRef(fork.chain, token),
  );
  const curves = [{ chain: fork.chain.ref, nativeAsset: fork.chain.nativeAsset, quoteTokens, rpc }];
  const venues = [createFlapVenue({ chains: curves }), createGeniusfunVenue({ chains: curves })];
  const multicall = bscContract("multicall3", "multicall3");
  const reads = {
    chain,
    evm: fork.chain,
    rpc,
    logsRpc: rpc,
    networkFeeCapWeiPerGas: () => 10n ** 9n,
    multicall,
  };
  const feeds = composeLaunchFeeds({
    chains,
    reads: new Map([[fork.chain.ref, reads]]),
    host: createVenueHost({ venues, chains, clock, callTimeoutMs: 15_000 }),
    launches: rig.stores.launches,
    publish: (push) => pushes.push(push),
    clock,
  });
  feeds.attach(rig.engine);
  const closers = createClosers();
  feeds.start(closers, createMemoryLogger({ subsystem: "watcher" }));
  return closers;
}

// Waits until `read` answers something `isDone` accepts, polling, or the time is up.
async function until<T>(read: () => Promise<T>, isDone: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + readTimeoutMs;
  const poll = async (): Promise<T> => {
    const value = await read();
    if (isDone(value) || Date.now() > deadline) {
      return value;
    }
    await wait(waitMs);
    return poll();
  };
  return poll();
}

function storedOf(rig: FillRig, fork: Fork) {
  return async (): Promise<readonly StoredLaunch[]> =>
    rig.stores.launches.list(
      { chain: fork.chain.ref, limit: 50 },
      { signal: AbortSignal.timeout(5_000) },
    );
}

// The last block the feed read, and the fork's head.
function readAndHead(rig: FillRig, fork: Fork) {
  return async () => {
    const [cursor, head] = await Promise.all([
      rig.stores.launches.cursor(fork.chain.ref, { signal: AbortSignal.timeout(5_000) }),
      fork.client.getBlockNumber({ cacheTime: 0 }),
    ]);
    return { read: cursor?.block, head };
  };
}

const isAtHead = (at: { readonly read: bigint | undefined; readonly head: bigint }): boolean =>
  at.read === at.head;

function firedAtLeast(count: number) {
  return (record: { readonly fires: number } | undefined): boolean => (record?.fires ?? 0) >= count;
}

// The two Flap salts the test launches with.
function saltsOf(): readonly [(typeof flapSalts)[number], (typeof flapSalts)[number]] {
  const [first, second] = flapSalts;
  if (first === undefined || second === undefined) {
    throw new BinferenceError({ code: "fork.no_salt", message: "The test needs two Flap salts." });
  }
  return [first, second];
}

function told(pushes: readonly EnginePush[]): readonly LaunchView[] {
  return pushes
    .filter(({ kind }) => kind === "launch/new")
    .map(({ data }) => data as unknown as LaunchView);
}

function launchText(launch: StoredLaunch): string {
  return `${launch.launchpad} ${launch.token} at ${String(launch.block)}`;
}

// The launch each fire of an alert handed the agent, from the `alert/fired` pushes that woke it.
function wokenBy(pushes: readonly EnginePush[]): readonly string[] {
  return pushes
    .filter(({ kind }) => kind === "alert/fired")
    .flatMap(({ data }) => {
      const fired = data as unknown as AlertFired;
      return fired.woke && fired.fired.kind === "launch" ? [fired.fired.launch.token] : [];
    });
}

// The data of the wake-ups waiting in the agent's inbox, as JSON; it takes them, as the runtime
// takes each wake-up before the next one comes.
async function takeWakeUps(rig: FillRig): Promise<readonly string[]> {
  const call = { signal: AbortSignal.timeout(5_000) };
  const untaken = await rig.stores.agentInbox.untaken({ agentId: fillAgent, limit: 10 }, call);
  await rig.stores.agentInbox.take({ ids: untaken.map(({ id }) => id), atMs: Date.now() }, call);
  return untaken.map(({ payload }) => JSON.stringify(payload));
}

// Of the test's launches, only Flap's pass this filter: Genius.fun's starting snipe tax is above
// it. The rig's engine runs neither launchpad, so the filter names none.
const flapOnly: LaunchFilter = launchFilterSchema.parse({
  maxTaxBps: 500,
  maxSnipeTaxBps: 1_000,
  maxInsiders: 1,
});

describe("the launch feed on a BSC fork", () => {
  it("records each Flap and geniusfun launch once in block order, resumes after an outage with no gap and no double, and fires a launch alert", async ({
    signal,
    annotate,
  }) =>
    onFillFork(signal, { token: xvs, flags: [] }, async (rig, fork) => {
      const condition = { kind: "launch", filters: {} } as const;
      const created = await rig.engine.handlers["alert/create"]({
        args: { agent: fillAgent, condition },
        caller: cliCaller,
        signal,
      });
      const alert = successOf(created).alert;
      // The fork's own block answers no logs: its node refuses them. The feed starts above it.
      await fork.call("evm_mine", []);
      const endpoint = switchableOf(fork);
      const pushes: EnginePush[] = [];
      const closers = feedOn(fork, rig, { endpoint, pushes });
      try {
        await until(readAndHead(rig, fork), isAtHead);
        const [flapSalt, secondSalt] = saltsOf();
        const launched: AssetRef[] = [];
        const token = (address: `0x${string}`) => erc20AssetRef(fork.chain, address);
        launched.push(token(await launchOnFlap(fork, { ...flapSalt, firstBuy })));
        launched.push(token((await launchOnGeniusfun(fork)).token));
        const before = await until(storedOf(rig, fork), (rows) => rows.length >= 2);
        endpoint.isDown = true;
        launched.push(token(await launchOnFlap(fork, { ...secondSalt, firstBuy })));
        launched.push(token((await launchOnGeniusfun(fork)).token));
        await fork.call("evm_mine", []);
        await wait(1_500);
        const whileDown = await storedOf(rig, fork)();
        endpoint.isDown = false;
        await until(readAndHead(rig, fork), isAtHead);
        const stored = await until(storedOf(rig, fork), (rows) => rows.length >= 4);
        const fired = await until(
          async () => rig.stores.alerts.get(alert, { signal }),
          firedAtLeast(4),
        );
        expect(before).toHaveLength(2);
        expect(whileDown).toHaveLength(2);
        expect(stored.map(({ token: asset }) => asset).toReversed()).toStrictEqual(launched);
        expect(told(pushes).map(({ token: asset }) => asset)).toStrictEqual(launched);
        expect(fired?.fires).toBe(4);
        const [flap, genius] = stored.toReversed();
        expect(flap).toMatchObject({
          launchpad: "flap",
          quoteToken: fork.chain.nativeAsset,
          symbol: "FEED",
          decimals: 18,
          taxBps: 100,
          graduated: false,
          insiders: [evmAccountRef(fork.chain, fork.account)],
        });
        expect(genius).toMatchObject({
          launchpad: "geniusfun",
          quoteToken: fork.chain.nativeAsset,
          symbol: "LWF",
          name: "Launch Wallet Fork",
          decimals: 18,
          taxBps: 0,
          snipeTaxBps: 9900,
          curveProgressBps: 0,
          graduated: false,
          insiders: [evmAccountRef(fork.chain, fork.account)],
        });
        await annotate(
          `fork block ${String(fork.block)}: ${stored.toReversed().map(launchText).join("; ")}`,
        );
      } finally {
        await closers.closeAll(AbortSignal.timeout(10_000));
      }
    }));

  it("wakes the agent, marked, for the two of five launches that pass a launch alert's filter", async ({
    signal,
    annotate,
  }) =>
    onFillFork(signal, { token: xvs, flags: [] }, async (rig, fork) => {
      const condition = { kind: "launch", filters: flapOnly } as const;
      const created = await rig.engine.handlers["alert/create"]({
        args: { agent: fillAgent, condition, wake: true },
        caller: cliCaller,
        signal,
      });
      const alert = successOf(created).alert;
      await fork.call("evm_mine", []);
      const pushes: EnginePush[] = [];
      const closers = feedOn(fork, rig, { endpoint: switchableOf(fork), pushes });
      try {
        await until(readAndHead(rig, fork), isAtHead);
        const [flapSalt, secondSalt] = saltsOf();
        const token = (address: `0x${string}`) => erc20AssetRef(fork.chain, address);
        const first = token(await launchOnFlap(fork, { ...flapSalt, firstBuy }));
        await until(async () => rig.stores.alerts.get(alert, { signal }), firedAtLeast(1));
        const firstWake = await takeWakeUps(rig);
        await launchOnGeniusfun(fork);
        await launchOnGeniusfun(fork);
        const second = token(await launchOnFlap(fork, { ...secondSalt, firstBuy }));
        await launchOnGeniusfun(fork);
        await fork.call("evm_mine", []);
        await until(readAndHead(rig, fork), isAtHead);
        const stored = await until(storedOf(rig, fork), (rows) => rows.length >= 5);
        const fired = await until(
          async () => rig.stores.alerts.get(alert, { signal }),
          firedAtLeast(2),
        );
        const secondWake = await takeWakeUps(rig);
        expect(stored).toHaveLength(5);
        expect(fired?.fires).toBe(2);
        expect(wokenBy(rig.pushes)).toStrictEqual([first, second]);
        expect([firstWake, secondWake].map((wakes) => wakes.length)).toStrictEqual([1, 1]);
        expect(firstWake[0]).toContain(`"token":"${first}"`);
        expect(secondWake[0]).toContain(`"token":"${second}"`);
        expect(
          [...firstWake, ...secondWake].map((wake) => wake.includes('"outsideContent":true')),
        ).toStrictEqual([true, true]);
        await annotate(
          `fork block ${String(fork.block)}: ${stored.toReversed().map(launchText).join("; ")}`,
        );
      } finally {
        await closers.closeAll(AbortSignal.timeout(10_000));
      }
    }));
});
