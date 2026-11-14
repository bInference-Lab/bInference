import { setTimeout as wait } from "node:timers/promises";
import type { ProtocolClient } from "@binference/client";
import { BinferenceError } from "@binference/core";
import { type IntentState, intentStates, isTerminalState } from "@binference/engine";
import type { ProtocolId } from "@binference/protocol";
import { createSqlitePositionStore } from "@binference/store";
import { describe, expect, inject, it, onTestFailed } from "vitest";
import type { SourceProgram } from "../e2e/source-program.js";
import { connectClient } from "../e2e/test-host.js";
import type { CrashContext } from "./crash-context.js";
import { armKillWith, restartWith, storyOf, useCrashHarness } from "./crash-harness.js";
import { type KeyHold, keyHeldMark } from "./crash-key-hold.js";
import { landedOf, unminedOf, withStore } from "./crash-reads.js";
import {
  buyCrashUsdt,
  type CrashInstall,
  type CrashWorld,
  goneLive,
  orderRequestOf,
  setUpCrashInstall,
} from "./crash-runs.js";

// Each run sends one keyed write from a fresh install as a client that names its request does,
// such as an MCP client's request id: a proposal, a confirmation of its card, or a live auto
// order. The engine is killed outright with the write's key marked started and its result not
// stored (decision 0437): at the mark, before the write runs; while the proposal it stored
// simulates its route; or once the write answered, before its result is stored. A second engine
// on the same folder then gets the same write with the same key, which must answer
// `protocol.outcome_unknown` and run nothing. The client lists what its write made since it sent
// it, sends it again with a new key only when nothing matches, and the owner confirms the card it
// finds. What reached the chain is counted by the test's relays and anvil, the signatures by the
// test's Privy, and the intents and bookings are read from the store, never from the engine.
const crash: CrashContext = inject("crash");
const harness = useCrashHarness(crash, { seed: 61 });
const runs = Array.from({ length: crash.runs }, (_, index) => index + 1);

/** The key the client names for its write, as an MCP client's request id becomes the call's key. */
const requestId = "crash-request-1";

/** Sends the run's write with `key`, or with a key of the client's own when it names none. */
type SendWrite = (
  client: ProtocolClient,
  key?: string,
) => Promise<{ readonly intent?: ProtocolId<"intent"> }>;

/** One keyed write a run cuts, as a client sends it. */
interface CutWrite {
  readonly op: KeyHold["op"];
  /** Whether live auto orders fill on the run's engines, as an order's write needs. */
  readonly fills: boolean;
  /**
   * Readies the write once the owner went live, such as the card a confirmation answers: how to
   * send it, and the time from which a change is the write's own.
   */
  readonly ready: (
    client: ProtocolClient,
    agent: ProtocolId<"agent">,
  ) => Promise<{ readonly send: SendWrite; readonly since: number }>;
  /** The intents a client that lost the answer finds its write made, after `since`. */
  readonly find: (
    client: ProtocolClient,
    since: number,
  ) => Promise<readonly ProtocolId<"intent">[]>;
  /** Whether nothing the write made moves again, once the client went on from the intent. */
  readonly isSettled: (
    client: ProtocolClient,
    intent: ProtocolId<"intent"> | undefined,
  ) => Promise<boolean>;
}

const call = (key?: string) => ({
  signal: AbortSignal.timeout(60_000),
  ...(key === undefined ? {} : { key }),
});

async function changedIntents(client: ProtocolClient, since: number) {
  const page = await client.call("intent/list", { changedSince: since, limit: 20 }, call());
  return page.items.map(({ intent }) => intent);
}

// The intent ended: nothing moves it again. One a stop cut before its card ended at the restart
// (decision 0444).
async function isIntentSettled(client: ProtocolClient, intent: ProtocolId<"intent"> | undefined) {
  if (intent === undefined) {
    return true;
  }
  const { state } = await client.call("intent/get", { intent }, call());
  return isTerminalState(state);
}

const settledOrders: ReadonlySet<string> = new Set(["filled", "cancelled", "expired", "ended"]);

const proposal: CutWrite = {
  op: "intent/propose",
  fills: false,
  ready: async (_client, agent) => ({
    send: async (client, key) => client.call("intent/propose", buyCrashUsdt(agent), call(key)),
    since: Date.now(),
  }),
  find: changedIntents,
  isSettled: isIntentSettled,
};

const confirmation: CutWrite = {
  op: "intent/confirm",
  fills: false,
  ready: async (client, agent) => {
    const proposed = await client.call("intent/propose", buyCrashUsdt(agent), call());
    const { card } = proposed;
    if (card === undefined) {
      throw new BinferenceError({ code: "crash.no_card", message: `No card: ${proposed.state}.` });
    }
    const tap = { intent: proposed.intent, card: card.card, cardVersion: card.version };
    // Only a move after the card opened is the confirmation's own.
    return {
      send: async (other, key) => other.call("intent/confirm", tap, call(key)),
      since: proposed.changedAt + 1,
    };
  },
  find: changedIntents,
  isSettled: isIntentSettled,
};

const liveOrder: CutWrite = {
  op: "order/create",
  fills: true,
  ready: async (_client, agent) => ({
    send: async (client, key) =>
      client.call("order/create", orderRequestOf("buy", agent), call(key)),
    since: Date.now(),
  }),
  // A fresh install holds no other order: each one is the write's.
  find: async (client) => {
    const page = await client.call("order/list", { limit: 20 }, call());
    return page.items.flatMap(({ intent }) => (intent === undefined ? [] : [intent]));
  },
  // Every order has ended, the one the owner confirmed with its fill.
  isSettled: async (client) => {
    const page = await client.call("order/list", { limit: 20 }, call());
    return page.items.every(({ state }) => settledOrders.has(state));
  },
};

/** Whether an intent was stored before the kill, or by the second engine. */
type StoredWhen = "before_kill" | "after_restart";

/** An intent of the run as the store holds it. */
interface StoredIntent {
  readonly stored: StoredWhen;
  readonly kind: string;
  readonly state: IntentState;
  readonly cards: number;
}

/** An intent the store holds, by its id. */
interface StoreRow extends Omit<StoredIntent, "stored"> {
  readonly id: string;
}

// Every intent the store holds, the first stored first, with its card versions.
async function intentsOf(folder: string): Promise<readonly StoreRow[]> {
  return withStore(folder, async ({ intents }, signal) => {
    const records = await intents.list({ states: intentStates, limit: 50 }, { signal });
    const ordered = records.toSorted(
      (left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id),
    );
    return Promise.all(
      ordered.map(async ({ id, kind, state }) => {
        const cards = await intents.cards(id, { signal });
        return { id, kind, state, cards: cards.length };
      }),
    );
  });
}

// The live executions the store recorded, of every intent.
async function executionsOf(folder: string): Promise<number> {
  return withStore(folder, async (_stores, signal, database) => {
    const page = { after: 0, limit: 100, isPaper: false };
    return (await createSqlitePositionStore(database).executions(page, { signal })).length;
  });
}

/** What a run's kill waits for once the write is on its way. */
type Reach = (run: {
  readonly world: CrashWorld;
  readonly install: CrashInstall;
  readonly first: SourceProgram;
}) => Promise<void>;

/** One kill point: the write, where the engine holds it or what else the kill waits for. */
interface ResendCase {
  readonly point: string;
  readonly write: CutWrite;
  /** Where the engine holds the write's key for good; none when the kill lands elsewhere. */
  readonly step?: KeyHold["step"];
  readonly reach: Reach;
  /** Whether blocks are mined before the kill, so what the write set going lands. */
  readonly isMinedBeforeKill?: boolean;
  readonly expected: ResendSummary;
}

/** What a run showed, or what its case says it must show. */
interface ResendSummary {
  /** The intents the store held when the engine died. */
  readonly atKill: readonly StoredIntent[];
  /** What the same write with the same key answered after the restart. */
  readonly resent: string;
  /** The intents the client found its write made, after it got that answer. */
  readonly found: readonly StoredWhen[];
  /** Every intent the store holds once the run ended, the first stored first. */
  readonly settled: readonly StoredIntent[];
  /** The distinct transactions and nonces that reached the relays from the wallet. */
  readonly sends: { readonly hashes: number; readonly nonces: number };
  readonly isEachLanded: boolean;
  readonly unmined: number;
  readonly signatures: { readonly beforeKill: number; readonly afterRestart: number };
  /** The live executions the store recorded. */
  readonly executions: number;
  readonly restartExit: number | undefined;
}

// The engine said it holds the write; an engine that ended first fails the run.
const untilHeld: Reach = async ({ first }) => {
  const line = await first.lineWith(keyHeldMark);
  if (!line.includes(keyHeldMark)) {
    throw new Error(`The engine never held the write:\n${line}`);
  }
};

// Polls the engine until `isDone` holds, every 200 ms for at most two minutes.
async function until(isDone: () => Promise<boolean>, deadline = Date.now() + 120_000) {
  if ((await isDone()) || Date.now() > deadline) {
    return;
  }
  await wait(200);
  await until(isDone, deadline);
}

// The engine holds the confirmation's result, and the swap it confirmed reconciles meanwhile.
const untilHeldAndLanded: Reach = async (run) => {
  await untilHeld(run);
  const client = await connectClient(run.install.machine);
  try {
    await until(async () => {
      const page = await client.call("intent/list", { state: "reconciled", limit: 5 }, call());
      return page.items.length > 0;
    });
  } finally {
    client.close();
  }
};

const untilSimulating: Reach = async ({ world }) =>
  world.chain.holdNextRead((request) => request.method === "eth_simulateV1");

// The owner confirms the card the intent waits on, if it waits on one.
async function confirmedIfAsked(client: ProtocolClient, intent: ProtocolId<"intent"> | undefined) {
  if (intent === undefined) {
    return;
  }
  const view = await client.call("intent/get", { intent }, call());
  if (view.state !== "awaiting_confirmation" || view.card === undefined) {
    return;
  }
  const tap = { intent, card: view.card.card, cardVersion: view.card.version };
  await client.call("intent/confirm", tap, call());
}

// What a call answered: `answered`, or the code it failed with.
async function codeOf(answer: Promise<unknown>): Promise<string> {
  try {
    await answer;
    return "answered";
  } catch (error) {
    return error instanceof BinferenceError ? error.code : "unexpected";
  }
}

/** A run killed at its point: its install, first engine and write, and what held then. */
interface Killed {
  readonly install: CrashInstall;
  readonly first: SourceProgram;
  readonly send: SendWrite;
  readonly since: number;
  readonly atKill: readonly StoreRow[];
  readonly signed: { readonly before: number; readonly atKill: number };
}

// A fresh install whose owner goes live and sends the case's write with the request's key, on an
// engine killed at the case's point; the client that sent it closes with its answer cut off.
async function killedRun(resend: ResendCase): Promise<Killed> {
  const world = harness.worldOf();
  const install = await setUpCrashInstall(world, harness.folders);
  const before = world.services.signatures();
  const { write, step } = resend;
  const keyHold = step === undefined ? {} : { keyHold: { op: write.op, step } };
  const first = await harness.startEngine(install, { fills: write.fills, ...keyHold });
  const client = await connectClient(install.machine);
  const agent = await goneLive(client, call());
  const { send, since } = await write.ready(client, agent.id);
  const miner = new AbortController();
  const isMined = resend.isMinedBeforeKill === true;
  const mining = isMined ? world.chain.mine(miner.signal) : Promise.resolve();
  const killed = armKillWith(first, resend.point, async (kill) => {
    await resend.reach({ world, install, first });
    return kill();
  });
  const cut = send(client, requestId).catch(() => undefined);
  await killed.finally(() => miner.abort());
  await mining;
  client.close();
  await cut;
  const atKill = await intentsOf(install.machine.folder);
  return {
    install,
    first,
    send,
    since,
    atKill,
    signed: { before, atKill: world.services.signatures() },
  };
}

/** What the client saw on the second engine. */
interface Resent {
  readonly resent: string;
  readonly found: readonly ProtocolId<"intent">[];
}

// On the second engine: the same write with the same key, then what the client finds its write
// made since it sent it; with nothing found it sends the write again with a new key, and the owner
// confirms the card the run's intent waits on. Stops the engine once nothing moves any more.
async function resentAndStopped(killed: Killed, write: CutWrite): Promise<Resent> {
  const client = await connectClient(killed.install.machine);
  try {
    const resent = await codeOf(killed.send(client, requestId));
    const found = await write.find(client, killed.since);
    const intent = found[0] ?? (await killed.send(client)).intent;
    await confirmedIfAsked(client, intent);
    await until(async () => write.isSettled(client, intent));
    return { resent, found };
  } finally {
    await client.call("engine/stop", {}, { signal: AbortSignal.timeout(10_000) }).catch(() => ({}));
    client.close();
  }
}

// Each intent as stored before the kill or by the second engine.
function storedAs(atKill: readonly StoreRow[]) {
  const before = new Set(atKill.map(({ id }) => id));
  const when = (id: string): StoredWhen => (before.has(id) ? "before_kill" : "after_restart");
  return {
    when,
    intent: ({ id, ...row }: StoreRow): StoredIntent => ({ stored: when(id), ...row }),
  };
}

/**
 * Runs one write to a forced stop at the case's point and sends it again on a second engine on the
 * same folder, with blocks mined until the run settles; reads what reached the chain, what custody
 * signed and what the store holds.
 */
async function crashResendOnce(resend: ResendCase) {
  const { chain, services } = harness.worldOf();
  const killed = await killedRun(resend);
  const { install, signed } = killed;
  const settle = async () => resentAndStopped(killed, resend.write);
  const restart = { isMinedAfterResend: false, fills: resend.write.fills, settle };
  const second = await restartWith(harness, install, restart);
  const { folder } = install.machine;
  const sends = chain.sends().filter((send) => send.from === install.from);
  const hashes = new Set(sends.map(({ hash }) => hash));
  const stored = storedAs(killed.atKill);
  const summary: ResendSummary = {
    atKill: killed.atKill.map(stored.intent),
    resent: second.settled.resent,
    found: second.settled.found.map(stored.when),
    settled: (await intentsOf(folder)).map(stored.intent),
    sends: { hashes: hashes.size, nonces: new Set(sends.map(({ nonce }) => nonce)).size },
    isEachLanded: (await landedOf(chain, sends)).length === hashes.size,
    unmined: await unminedOf(chain, install.from),
    signatures: {
      beforeKill: signed.atKill - signed.before,
      afterRestart: services.signatures() - signed.atKill,
    },
    executions: await executionsOf(folder),
    restartExit: await second.engine.program.exited,
  };
  return { summary, story: await storyOf(folder, [killed.first, second.engine]) };
}

const unknown = "protocol.outcome_unknown";

function swapAt(stored: StoredWhen, state: IntentState, cards: number): StoredIntent {
  return { stored, kind: "swap", state, cards };
}

/** One swap or fill that landed once, booked once, as a run that traded must show. */
const tradedOnce = {
  sends: { hashes: 1, nonces: 1 },
  isEachLanded: true,
  unmined: 0,
  executions: 1,
  restartExit: 0,
} as const;

const cases: readonly ResendCase[] = [
  {
    point: "once a proposal's key is marked",
    write: proposal,
    step: "marked",
    reach: untilHeld,
    expected: {
      atKill: [],
      resent: unknown,
      found: [],
      settled: [swapAt("after_restart", "reconciled", 1)],
      ...tradedOnce,
      signatures: { beforeKill: 0, afterRestart: 1 },
    },
  },
  {
    point: "while a stored proposal simulates",
    write: proposal,
    reach: untilSimulating,
    expected: {
      atKill: [swapAt("before_kill", "checked", 0)],
      resent: unknown,
      found: ["before_kill"],
      settled: [swapAt("before_kill", "cancelled", 0)],
      sends: { hashes: 0, nonces: 0 },
      isEachLanded: true,
      unmined: 0,
      executions: 0,
      restartExit: 0,
      signatures: { beforeKill: 0, afterRestart: 0 },
    },
  },
  {
    point: "once a proposal opened its card",
    write: proposal,
    step: "finishing",
    reach: untilHeld,
    expected: {
      atKill: [swapAt("before_kill", "awaiting_confirmation", 1)],
      resent: unknown,
      found: ["before_kill"],
      settled: [swapAt("before_kill", "reconciled", 1)],
      ...tradedOnce,
      signatures: { beforeKill: 0, afterRestart: 1 },
    },
  },
  {
    point: "once a confirmation's key is marked",
    write: confirmation,
    step: "marked",
    reach: untilHeld,
    expected: {
      atKill: [swapAt("before_kill", "awaiting_confirmation", 1)],
      resent: unknown,
      found: [],
      settled: [swapAt("before_kill", "reconciled", 1)],
      ...tradedOnce,
      signatures: { beforeKill: 0, afterRestart: 1 },
    },
  },
  {
    point: "once a confirmation's swap landed",
    write: confirmation,
    step: "finishing",
    reach: untilHeldAndLanded,
    isMinedBeforeKill: true,
    expected: {
      atKill: [swapAt("before_kill", "reconciled", 1)],
      resent: unknown,
      found: ["before_kill"],
      settled: [swapAt("before_kill", "reconciled", 1)],
      ...tradedOnce,
      signatures: { beforeKill: 1, afterRestart: 0 },
    },
  },
  {
    point: "once a live order opened its card",
    write: liveOrder,
    step: "finishing",
    reach: untilHeld,
    expected: {
      atKill: [
        { stored: "before_kill", kind: "autoOrder", state: "awaiting_confirmation", cards: 1 },
      ],
      resent: unknown,
      found: ["before_kill"],
      settled: [
        { stored: "before_kill", kind: "autoOrder", state: "reconciled", cards: 1 },
        { stored: "after_restart", kind: "buy", state: "reconciled", cards: 0 },
      ],
      ...tradedOnce,
      signatures: { beforeKill: 0, afterRestart: 1 },
    },
  },
];

describe.each(cases)("an engine killed $point, before the write's result is stored", (resend) => {
  it.each(runs)("answers the same key unknown and runs the write once, run %i", async () => {
    const outcome = await crashResendOnce(resend);
    // A failed run shows what both engines reported and what the engine log holds.
    onTestFailed(() => {
      process.stderr.write(`${outcome.story}\n`);
    });
    expect(outcome.summary).toStrictEqual(resend.expected);
  });
});
