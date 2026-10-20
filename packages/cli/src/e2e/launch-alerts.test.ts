import {
  type AssetRef,
  accountRefSchema,
  assetRefSchema,
  chainRefSchema,
  isTxHash,
  type TxHash,
} from "@binference/chain";
import { BinferenceError, type Bps, bpsSchema } from "@binference/core";
import { createRunningTurns } from "@binference/engine/chat";
import { type NewLaunch, tellLaunches } from "@binference/engine/market";
import { testAgent, testCoin, testToken } from "@binference/engine/testing";
import { callsReply, type InProcessRuntime } from "@binference/runtime/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  type Skeleton,
  skeletonChains,
  skeletonCompositions,
  startSkeleton,
} from "../compose/test-skeleton.js";
import { superviseRuntime, watchChat } from "./runtime-machine.js";

// Launch alerts end to end: the owner sets a launch alert with `wake` from the CLI, five launches
// reach the engine as the launch feed tells them, two pass the filter and wake the agent, and the
// runtime's turn on the scripted model proposes a swap. The turn read a launch, outside content,
// so the agent in auto mode gets a card that carries the warning (Y8) and nothing fills.

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });
const slow = { timeout: 30_000 };
const stops: (() => Promise<void>)[] = [];
const chain = chainRefSchema.parse("fake:1");
const hash = txHashOf(`0x${"1".padStart(64, "0")}`);
const bps = (value: number): Bps => bpsSchema.parse(value);

function txHashOf(text: string): TxHash {
  if (!isTxHash(text)) {
    throw new BinferenceError({ code: "test.no_hash", message: "Not a transaction hash." });
  }
  return text;
}

afterEach(async () => {
  await Promise.all(stops.splice(0).map(async (stop) => stop()));
});

const filters = {
  maxTaxBps: bps(500),
  maxSnipeTaxBps: bps(1_000),
  minCurveProgressBps: bps(100),
  maxInsiders: 2,
} as const;

// A swap the model proposes with the agent's own swap tool, after the wake-up.
const swapTerms = {
  from: testCoin,
  to: testToken,
  amount: { base: "1000000" },
  reason: "A launch passed the owner's filter.",
};

/** The token of the window's `n`th launch. */
const tokenOf = (n: number): AssetRef =>
  assetRefSchema.parse(`fake:1/token:0x000000${n.toString(16).padStart(2, "0")}`);

/** The `n`th launch of the window on the skeleton's launchpad, with what differs from a clean one. */
function launchOf(n: number, differs: Partial<NewLaunch>): NewLaunch {
  return {
    token: tokenOf(n),
    launchpad: "fake-curve",
    creator: accountRefSchema.parse(`fake:1:0x000000c${String(n)}`),
    quoteToken: testCoin,
    symbol: `L${String(n)}`,
    decimals: 18,
    taxBps: bps(100),
    snipeTaxBps: bps(0),
    curveProgressBps: bps(500),
    graduated: false,
    insiders: [accountRefSchema.parse("fake:1:0x000000a1")],
    block: 1n,
    blockHash: hash,
    txHash: hash,
    logIndex: n,
    launchedAtMs: 0,
    ...differs,
  };
}

// Five launches in two blocks, in log order: the first and the last pass the filter; each other
// one fails it on one bound, its tax, its snipe tax or its curve.
const blocks: readonly (readonly NewLaunch[])[] = [
  [launchOf(1, {}), launchOf(2, { taxBps: bps(1_000) }), launchOf(3, { snipeTaxBps: bps(9_900) })],
  [launchOf(4, { curveProgressBps: bps(50), block: 2n }), launchOf(5, { block: 2n })],
];

async function startMachine() {
  const [selfHosted] = skeletonCompositions;
  if (selfHosted === undefined) {
    throw new BinferenceError({ code: "test.no_composition", message: "No composition." });
  }
  const turns = createRunningTurns();
  const skeleton = await startSkeleton(selfHosted.parts(), { turns });
  stops.push(async () => skeleton.close());
  await skeleton.client.call("approval/set", { agent: testAgent, mode: "auto" }, live());
  await skeleton.client.call("portfolio/resetPaper", { agent: testAgent }, live());
  const engine = { ...skeleton, stores: skeleton.parts.stores, server: skeleton.composed.server };
  // A turn ends at its proposal, so each wake-up's turn takes one answer: the swap.
  const swap = callsReply([{ name: "swap", args: swapTerms }]);
  const started: InProcessRuntime[] = [];
  const startRuntime = (): void => {
    const supervisor = superviseRuntime(engine, {
      turns,
      script: { replies: [swap, swap] },
      started,
    });
    stops.unshift(async () => supervisor.stop(AbortSignal.timeout(10_000)));
  };
  return { skeleton, chat: watchChat(skeleton.client, testAgent), started, startRuntime };
}

// Sets the owner's launch alert that wakes the agent, from the CLI.
async function setLaunchAlert(skeleton: Skeleton) {
  const condition = { kind: "launch", filters } as const;
  const args = { agent: testAgent, condition, wake: true };
  return skeleton.client.call("alert/create", args, live());
}

// Which of the window's five launches the agent's model was told of.
function toldOf(started: readonly InProcessRuntime[]): readonly boolean[] {
  const asked = JSON.stringify(started.flatMap(({ transports }) => transports.main.requests));
  return [1, 2, 3, 4, 5].map((n) => asked.includes(tokenOf(n)));
}

// Stores one block's launches as the launch feed does, and tells them to the launch alerts.
async function feedBlock(skeleton: Skeleton, launches: readonly NewLaunch[]): Promise<void> {
  const [first] = launches;
  const block = first?.block ?? 1n;
  const atMs = skeleton.clock.now();
  const read = { chain, from: block, to: block, toHash: "0x01", atMs, changes: [] };
  const timed = launches.map((launch) => ({ ...launch, launchedAtMs: atMs - 3_000 }));
  const stored = await skeleton.parts.stores.launches.record({ ...read, launches: timed }, live());
  const tell = {
    chains: skeletonChains(),
    publish: () => undefined,
    alerts: skeleton.composed.engine.alerts,
  };
  await tellLaunches(tell, stored, live());
}

describe("launch alerts end to end", () => {
  it(
    "wake the agent for the two of five launches that pass, and each card warns",
    slow,
    async () => {
      const { skeleton, chat, started, startRuntime } = await startMachine();
      const created = await setLaunchAlert(skeleton);
      startRuntime();
      const [firstBlock = [], secondBlock = []] = blocks;
      await feedBlock(skeleton, firstBlock);
      await chat.turnsEnded(1);
      await feedBlock(skeleton, secondBlock);
      await chat.turnsEnded(2);

      expect(toldOf(started)).toStrictEqual([true, false, false, false, true]);
      const [listed] = (await skeleton.client.call("alert/list", { agent: testAgent }, live()))
        .items;
      expect(listed).toMatchObject({ alert: created.alert, fires: 2 });
      const { items } = await skeleton.client.call("intent/list", { agent: testAgent }, live());
      const marked = {
        state: "awaiting_confirmation",
        outsideContent: true,
        card: { outsideContent: true },
      };
      expect(items).toMatchObject([marked, marked]);
    },
  );

  it(
    "tell one turn of both launches that passed before the agent took the first",
    slow,
    async () => {
      const { skeleton, chat, started, startRuntime } = await startMachine();
      await setLaunchAlert(skeleton);
      const [firstBlock = [], secondBlock = []] = blocks;
      await feedBlock(skeleton, firstBlock);
      await feedBlock(skeleton, secondBlock);
      const waiting = await skeleton.parts.stores.agentInbox.untaken(
        { agentId: testAgent, limit: 10 },
        live(),
      );
      startRuntime();
      await chat.turnsEnded(1);

      expect(waiting.map(({ kind }) => kind)).toStrictEqual([
        "inbox/alertFired",
        "inbox/alertFired",
      ]);
      const [firstAsk] = started.flatMap(({ transports }) => transports.main.requests);
      expect(toldOf(started)).toStrictEqual([true, false, false, false, true]);
      expect(JSON.stringify(firstAsk?.messages)).toContain(tokenOf(1));
      expect(JSON.stringify(firstAsk?.messages)).toContain(tokenOf(5));
      const { items } = await skeleton.client.call("intent/list", { agent: testAgent }, live());
      expect(items).toMatchObject([{ state: "awaiting_confirmation", outsideContent: true }]);
    },
  );
});
