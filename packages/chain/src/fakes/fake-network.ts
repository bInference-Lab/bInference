import { BinferenceError, type Clock, err, ok } from "@binference/core";
import type { ChainRef } from "../caip/chain-ref.js";
import type { RelayBehavior, RelayDelivery } from "../contracts/relay-sender-contract.js";
import type { NonceSource } from "../ports.js";
import type { ReceiptReader, RelaySender, TxPreparer } from "../sending/ports.js";
import type { RelayAnswer } from "../sending/relay-answer.js";
import type { AssetTransfer } from "../simulation/simulated-step.js";
import type { TxHash, UnsignedTx } from "../transaction.js";
import { createFakeLedger, type FakeLedger, type FakeSent, readFakeSent } from "./fake-ledger.js";

/**
 * One fake chain for tests, as the wallet queue sees it: it prepares drafts, takes signed
 * transactions through its relays, mines them when the test says so and reads their receipts.
 * Each relay answers as the test scripts it; a relay that takes a transaction puts it in the pool.
 */
export interface FakeNetwork extends TxPreparer, RelaySender, ReceiptReader, NonceSource {
  /** Sets how a relay answers from now on; every relay accepts until a test says otherwise. */
  script(relay: string, behavior: RelayBehavior): void;
  /** Makes drafts with this payload fail now: `prepare` answers `would_fail`. */
  failing(payload: string): void;
  /** Lets drafts with this payload run again. */
  passing(payload: string): void;
  /** Mines `count` blocks, 1 when absent. */
  mine(count?: number): void;
  /** Takes a transaction out of its block, as a reorg would. */
  reorg(hash: TxHash): void;
  /** Forgets the state of every block below `block`, as a node that prunes old state does. */
  forgetStateBelow(block: bigint): void;
  /** Makes the next `count` reads of receipts or the head fail, as a node that is down. */
  failReads(count: number): void;
  /** Sets the fee per gas the next drafts are prepared with. */
  setFeePerGas(feePerGasBase: bigint): void;
  /** Every signed transaction the relays received, in the order it arrived. */
  received(): readonly RelayDelivery[];
  /** How many times `send` was called. */
  sends(): number;
}

/** What a fake network starts with. */
export interface FakeNetworkOptions {
  readonly chain: ChainRef;
  readonly clock: Clock;
  /** The relays' names, in order; `relay-a` and `relay-b` when absent. */
  readonly relays?: readonly string[];
  /** The chain's network fee cap per gas; above it a prepared draft is marked. */
  readonly feeCapBase?: bigint;
  /** How many blocks below the latest are not final yet; 2 when absent. */
  readonly finalityDepth?: bigint;
  /** Draft payloads whose transactions revert once a block holds them. */
  readonly reverting?: readonly string[];
  /** What a transaction that ran moved, by what it was sent as; nothing when absent. */
  readonly transfers?: (sent: FakeSent) => readonly AssetTransfer[];
  /** The native coin a transaction that ran received without a log; none when absent. */
  readonly nativeReceived?: (sent: FakeSent) => bigint;
}

const defaultFee = 50_000_000n;

function otherChain(chain: ChainRef): BinferenceError {
  return new BinferenceError({
    code: "chain.unknown_chain",
    message: `The fake network serves one chain, not ${chain}.`,
    details: { chain },
  });
}

/** The bytes each relay received, in the order they arrived. */
interface Deliveries {
  readonly add: (delivery: RelayDelivery) => void;
  readonly list: () => readonly RelayDelivery[];
}

function createDeliveries(): Deliveries {
  const deliveries: RelayDelivery[] = [];
  return {
    add(delivery) {
      deliveries.push(delivery);
    },
    list: () => [...deliveries],
  };
}

interface Relaying {
  readonly ledger: FakeLedger;
  readonly scripts: ReadonlyMap<string, RelayBehavior>;
  readonly deliveries: Deliveries;
  readonly clock: Clock;
}

// A relay that takes the bytes pools them; one that holds them already, or whose nonce a block
// holds, refuses them.
function accepted(relaying: Relaying, relay: string, raw: string): RelayAnswer {
  const atMs = relaying.clock.now();
  const pooled = relaying.ledger.pool(readFakeSent(relaying.ledger.chain, raw));
  return pooled === "pooled"
    ? { relay, outcome: "accepted", atMs }
    : { relay, outcome: "refused", reason: "nonce_too_low", atMs };
}

function answerOf(relaying: Relaying, relay: string, raw: string): RelayAnswer {
  const behavior = relaying.scripts.get(relay) ?? { kind: "accept" };
  const atMs = relaying.clock.now();
  if (behavior.kind === "unreachable") {
    return { relay, outcome: "unreachable", atMs };
  }
  relaying.deliveries.add({ relay, raw });
  if (behavior.kind === "hang") {
    return { relay, outcome: "timed_out", atMs };
  }
  return behavior.kind === "refuse"
    ? { relay, outcome: "refused", reason: behavior.reason, atMs }
    : accepted(relaying, relay, raw);
}

/** What a fake network holds besides its ledger. */
interface NetworkState {
  readonly options: FakeNetworkOptions;
  readonly ledger: FakeLedger;
  readonly scripts: Map<string, RelayBehavior>;
  readonly failingPayloads: Set<string>;
  readonly deliveries: Deliveries;
  readonly dials: Dials;
}

/** The numbers a test turns: the fee per gas, the sends counted, the reads that fail. */
interface Dials {
  readonly feePerGas: () => bigint;
  readonly setFeePerGas: (fee: bigint) => void;
  readonly countSend: () => void;
  readonly sends: () => number;
  readonly failReads: (count: number) => void;
  /** Throws while reads are set to fail, counting each one. */
  readonly read: () => void;
}

function createDials(): Dials {
  let feePerGasBase = defaultFee;
  let sendCount = 0;
  let failingReads = 0;
  return {
    feePerGas: () => feePerGasBase,
    setFeePerGas(fee) {
      feePerGasBase = fee;
    },
    countSend() {
      sendCount += 1;
    },
    sends: () => sendCount,
    failReads(count) {
      failingReads = count;
    },
    read() {
      if (failingReads > 0) {
        failingReads -= 1;
        throw new BinferenceError({
          code: "chain.rpc_down",
          message: "The fake network's node is down.",
          retryable: true,
        });
      }
    },
  };
}

function served(state: NetworkState, asked: ChainRef): void {
  if (asked !== state.options.chain) {
    throw otherChain(asked);
  }
}

function preparerOf(state: NetworkState): TxPreparer {
  return {
    async prepare({ draft, nonce }, { signal }) {
      signal.throwIfAborted();
      served(state, draft.chain);
      if (state.failingPayloads.has(draft.payload)) {
        return await Promise.resolve(err("would_fail"));
      }
      const feePerGasBase = state.dials.feePerGas();
      const payload = [draft.payload, String(nonce), feePerGasBase.toString()].join("|");
      const unsigned: UnsignedTx = { chain: draft.chain, from: draft.from, payload };
      const isAboveFeeCap = feePerGasBase > (state.options.feeCapBase ?? defaultFee * 20n);
      return await Promise.resolve(ok({ unsigned, feePerGasBase, isAboveFeeCap }));
    },
  };
}

function readersOf(state: NetworkState): ReceiptReader & NonceSource {
  return {
    async receipt(asked, hash, { signal }) {
      signal.throwIfAborted();
      served(state, asked);
      state.dials.read();
      return await Promise.resolve(state.ledger.receipt(hash));
    },
    async head(asked, { signal }) {
      signal.throwIfAborted();
      served(state, asked);
      state.dials.read();
      return await Promise.resolve(state.ledger.head());
    },
    async transfers(asked, hash, { signal }) {
      signal.throwIfAborted();
      served(state, asked);
      state.dials.read();
      return await Promise.resolve(state.ledger.transfers(hash));
    },
    async nonceAt(account, block, { signal }) {
      signal.throwIfAborted();
      state.dials.read();
      return await Promise.resolve(state.ledger.nonceAt(account, block));
    },
    async nativeReceived(account, block, { signal }) {
      signal.throwIfAborted();
      state.dials.read();
      const received = state.ledger.nativeReceived(account, block);
      return await Promise.resolve(received === undefined ? err("state_gone") : ok(received));
    },
    async next(account, { signal }) {
      signal.throwIfAborted();
      return await Promise.resolve(state.ledger.nextNonce(account));
    },
  };
}

function senderOf(state: NetworkState): RelaySender {
  const relays = state.options.relays ?? ["relay-a", "relay-b"];
  return {
    relays,
    async send(signed, { signal }) {
      signal.throwIfAborted();
      served(state, signed.chain);
      state.dials.countSend();
      const { ledger, scripts, deliveries } = state;
      const relaying = { ledger, scripts, deliveries, clock: state.options.clock };
      return await Promise.resolve(relays.map((relay) => answerOf(relaying, relay, signed.raw)));
    },
  };
}

/** Creates a {@link FakeNetwork} at block 0 whose relays all accept. */
export function createFakeNetwork(options: FakeNetworkOptions): FakeNetwork {
  const ledger = createFakeLedger({
    chain: options.chain,
    finalityDepth: options.finalityDepth ?? 2n,
    reverting: new Set(options.reverting ?? []),
    ...(options.transfers === undefined ? {} : { transfersOf: options.transfers }),
    ...(options.nativeReceived === undefined ? {} : { nativeReceivedOf: options.nativeReceived }),
  });
  const dials = createDials();
  const state: NetworkState = {
    options,
    ledger,
    scripts: new Map(),
    failingPayloads: new Set(),
    deliveries: createDeliveries(),
    dials,
  };
  return {
    ...preparerOf(state),
    ...senderOf(state),
    ...readersOf(state),
    script(relay, behavior) {
      state.scripts.set(relay, behavior);
    },
    failing(payload) {
      state.failingPayloads.add(payload);
    },
    passing(payload) {
      state.failingPayloads.delete(payload);
    },
    mine(count = 1) {
      ledger.mine(count);
    },
    reorg(hash) {
      ledger.reorg(hash);
    },
    forgetStateBelow(block) {
      ledger.forgetStateBelow(block);
    },
    setFeePerGas: dials.setFeePerGas,
    failReads: dials.failReads,
    received: state.deliveries.list,
    sends: dials.sends,
  };
}
