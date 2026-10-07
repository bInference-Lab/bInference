import {
  type ChainRef,
  chainRefSchema,
  type TxHash,
  type RelaySender,
  type SignRequest,
  type Signer,
} from "@binference/chain";
import {
  createFakeNetwork,
  type FakeNetwork,
  type FakeNetworkOptions,
} from "@binference/chain/testing";
import { createIdSource, type Id } from "@binference/core";
import {
  createMemoryLogger,
  createSeededRandom,
  type MemoryLogger,
} from "@binference/core/testing";
import type { IntentRequest } from "@binference/protocol";
import type { AgentDraft } from "../agents/agent-record.js";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import { createFakeWalletFacts } from "../fakes/fake-wallet-facts.js";
import type { IntentState } from "../intents/intent-state.js";
import { expectOk, testAgent, testCoin, testSwap, testWallet } from "../intents/test-intents.js";
import type { WalletFacts } from "../money-path/wallet-facts.js";
import {
  startTestEngine,
  type TestEngine,
  testAccount,
  testCall,
  testChains,
} from "../operations/test-engine.js";
import type { Executor, IntentStore, TransactionStore } from "../ports.js";
import type { EnginePush } from "../pushes/engine-push.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import { createWalletQueue } from "../wallet-queue/wallet-queue.js";
import { createExecutor, type RunningExecutor } from "./create-executor.js";
import type { ExecutorLimits } from "./executor-options.js";

/** The fake chain the test engine trades on. */
export const benchChain: ChainRef = chainRefSchema.parse("fake:1");

/** A test engine whose confirmed live intents reach a real executor on a fake network. */
export interface ExecutorBench {
  readonly test: TestEngine;
  readonly executor: RunningExecutor;
  readonly network: FakeNetwork;
  readonly logger: MemoryLogger;
  /** Every signing request custody received, oldest first. */
  readonly signed: readonly SignRequest[];
  /** Every push the executor sent. */
  readonly pushes: readonly EnginePush[];
  /** Each send's bytes, with the bytes the store held for the wallet as the send began. */
  readonly sends: readonly BenchSend[];
  /** Hands the intents the engine confirmed to the executor; until then they wait. */
  release(): Promise<void>;
}

/** One send the relays got, and what the transaction store held when it began. */
interface BenchSend {
  readonly raw: string;
  readonly stored: readonly string[];
}

/** How a bench differs from the default: a live agent in manual mode that hands intents on. */
export interface BenchOptions {
  readonly agent?: Partial<AgentDraft>;
  readonly network?: Partial<FakeNetworkOptions>;
  readonly limits?: Partial<ExecutorLimits>;
  /** Holds confirmed intents until `release`, so a test can change the world before the queue. */
  readonly hold?: boolean;
  /** Wraps the custody the executor signs through. */
  readonly custody?: (custody: Signer) => Signer;
  /** Wraps the transaction store the executor and its queue write through. */
  readonly transactions?: (store: TransactionStore) => TransactionStore;
  /** Leaves the fake chain without sending parts. */
  readonly withoutRelays?: boolean;
  /** Wraps the intent store the executor writes through, not the engine's. */
  readonly intents?: (store: IntentStore) => IntentStore;
}

const facts: WalletFacts = {
  nativeBalanceBase: 10n ** 18n,
  ceilingPerTxNativeBase: 10n ** 18n,
  feePerGasNativeBase: 50_000_000n,
  networkFeeCapNativeBase: 1_000_000_000n,
  recentOutflows: [],
};

function countingSigner(custody: Signer, note: (request: SignRequest) => void) {
  const counting: Signer = {
    account: async (wallet, chain, options) => custody.account(wallet, chain, options),
    async signTransaction(request, options) {
      note(request);
      return custody.signTransaction(request, options);
    },
  };
  return counting;
}

// A sender that notes, as each send begins, the bytes it sends and what the store holds.
function notingSender(
  network: FakeNetwork,
  transactions: TransactionStore,
  note: (send: BenchSend) => void,
) {
  const sender: RelaySender = {
    relays: network.relays,
    async send(transaction, call) {
      const query = { account: testAccount, fromNonce: 0, limit: 100 };
      const stored = await transactions.list(query, call);
      note({ raw: transaction.raw, stored: stored.map(({ raw }) => raw) });
      return network.send(transaction, call);
    },
  };
  return sender;
}

/** What the bench's executor is built over, besides the test engine. */
interface BenchParts {
  readonly test: TestEngine;
  readonly network: FakeNetwork;
  readonly signed: readonly SignRequest[];
  readonly pushes: readonly EnginePush[];
  readonly sends: readonly BenchSend[];
  readonly logger: MemoryLogger;
}

/** Where the bench's executor notes what it signs, pushes and sends. */
interface BenchNotes {
  readonly signed: (request: SignRequest) => void;
  readonly pushed: (push: EnginePush) => void;
  readonly sent: (send: BenchSend) => void;
}

function executorOf(
  parts: Pick<BenchParts, "test" | "network" | "logger">,
  notes: BenchNotes,
  options: BenchOptions,
): RunningExecutor {
  const { test, network, logger } = parts;
  const stored = test.stores.transactions;
  const transactions = options.transactions?.(stored) ?? stored;
  const custody = countingSigner(options.custody?.(test.custody) ?? test.custody, notes.signed);
  const sending = {
    preparer: network,
    sender: notingSender(network, transactions, notes.sent),
    receipts: network,
  };
  const price = { numerator: 600n, denominator: 10n ** 12n };
  const intents = options.intents?.(test.stores.intents) ?? test.stores.intents;
  return createExecutor({
    stores: { ...test.stores, transactions, intents },
    queue: createWalletQueue({ transactions, nonces: network, clock: test.clock }),
    custody,
    wallets: createFakeWalletFacts(new Map([[testAgent, [testWallet]]]), facts),
    prices: createFakePriceSource(new Map([[testCoin, price]])),
    chains: testChains(),
    sending: new Map(options.withoutRelays === true ? [] : [[benchChain, sending]]),
    clock: test.clock,
    ids: createIdSource({ clock: test.clock, random: createSeededRandom(9) }),
    publish: notes.pushed,
    logger,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
}

/** Starts an engine with a live agent, whose executor sends on a fake network. */
export async function startExecutorBench(options: BenchOptions = {}): Promise<ExecutorBench> {
  const waiting: Id<"int">[] = [];
  const lazy: { executor?: RunningExecutor } = {};
  const proxy: Executor = {
    async take(intent, call) {
      if (options.hold === true || lazy.executor === undefined) {
        waiting.push(intent);
        return;
      }
      await lazy.executor.take(intent, call);
    },
  };
  const test = await startTestEngine({
    agent: { mode: "live", ...options.agent },
    executor: proxy,
  });
  const network = createFakeNetwork({ chain: benchChain, clock: test.clock, ...options.network });
  const logger = createMemoryLogger({ subsystem: "engine" });
  const signed: SignRequest[] = [];
  const pushes: EnginePush[] = [];
  const sends: BenchSend[] = [];
  const notes: BenchNotes = {
    signed: (request) => signed.push(request),
    pushed: (push) => pushes.push(push),
    sent: (send) => sends.push(send),
  };
  const parts: BenchParts = { test, network, signed, pushes, sends, logger };
  const executor = executorOf(parts, notes, options);
  lazy.executor = executor;
  const release = async (): Promise<void> => {
    const call = { signal: new AbortController().signal };
    await Promise.all(waiting.splice(0).map(async (intent) => executor.take(intent, call)));
  };
  return { ...parts, executor, release };
}

/**
 * Lets the bench's promise chains run: the unit tests' timers are fake, so only microtask turns
 * move a run along, enough of them for the longest chain between two waits.
 */
export async function flush(turns = 1_000): Promise<void> {
  if (turns > 0) {
    await Promise.resolve();
    await flush(turns - 1);
  }
}

/** The intent's state in the store now. */
export async function stateOf(bench: ExecutorBench, intent: Id<"int">): Promise<IntentState> {
  const record = await bench.test.stores.intents.get(intent, {
    signal: new AbortController().signal,
  });
  if (record === undefined) {
    throw new Error(`Intent ${intent} is not stored.`);
  }
  return record.state;
}

/**
 * Mines a block and moves the clock a block ahead until the intent reaches one of `states`, at
 * most `blocks` times, and answers the state it reached.
 */
export async function driveUntil(
  bench: ExecutorBench,
  intent: Id<"int">,
  goal: { readonly states: readonly IntentState[]; readonly blocks?: number },
): Promise<IntentState> {
  await flush();
  const state = await stateOf(bench, intent);
  const blocks = goal.blocks ?? 40;
  if (goal.states.includes(state) || blocks === 0) {
    return state;
  }
  bench.network.mine();
  await bench.test.clock.advance(1_000);
  return driveUntil(bench, intent, { states: goal.states, blocks: blocks - 1 });
}

/** The owner's tap on the card of a swap the CLI proposed; the engine hands it to the executor. */
export async function tapped(
  bench: ExecutorBench,
  request: IntentRequest = testSwap(),
): Promise<Id<"int">> {
  const handlers = bench.test.engine.handlers;
  const view = expectOk(await handlers["intent/propose"](testCall(request)));
  const card = view.card?.card ?? fixtureId("crd", 0);
  const args = { intent: view.intent, card, cardVersion: 1 };
  expectOk(await handlers["intent/confirm"](testCall(args)));
  return view.intent;
}

/** What the executor logged, each record as `event:errorCode`. */
export function eventsOf(bench: ExecutorBench): readonly string[] {
  return bench.logger.records().map((record) => `${record.event}:${record.fields.errorCode ?? ""}`);
}

/** The test wallet's stored transactions, by nonce. */
export async function transactionsOf(bench: ExecutorBench): Promise<readonly TransactionRecord[]> {
  const query = { account: testAccount, fromNonce: 0, limit: 10 };
  return bench.test.stores.transactions.list(query, { signal: new AbortController().signal });
}

/** A stored transaction's hash; a test that has none fails. */
export function hashOf(transaction: TransactionRecord | undefined): TxHash {
  if (transaction === undefined) {
    throw new Error("Expected a stored transaction.");
  }
  return transaction.hash;
}

/** The number of the block that holds a stored transaction, or -1 for none. */
export function blockOf(transaction: TransactionRecord | undefined): bigint {
  return transaction?.receipt?.block.number ?? -1n;
}
