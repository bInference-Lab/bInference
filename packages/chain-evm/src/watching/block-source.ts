import { BinferenceError, type Clock } from "@binference/core";
import type { Hex } from "viem";
import { quantitySchema } from "../rpc/evm-wire.schema.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import { followHeads, type HeadsEnded } from "./follow-heads.js";
import type { HeadSubscription } from "./head-socket.js";
import { repeatSteps } from "./repeat-steps.js";

/**
 * Why the source last failed to read a head: the subscription's reason, or `rpc_down` when no
 * endpoint answered a poll.
 */
export type BlockSourceFault = HeadsEnded | "rpc_down";

/** How a block source reads now, and the newest block it saw. */
export interface BlockSourceState {
  /** `subscription` while a WebSocket pushes heads, else `polling`. */
  readonly mode: "subscription" | "polling";
  /** The newest block number seen. */
  readonly head?: bigint;
  /** When the source saw that block, by its clock. */
  readonly headAtMs?: number;
  /**
   * The last failure: a socket's until a socket hands on a head again, a poll's until a poll does.
   */
  readonly fault?: BlockSourceFault;
}

/** How a head was seen: the failover endpoint whose poll saw it, or a reorganisation. */
export interface SeenHead {
  /** The endpoint that answered the poll that saw it; none for a socket's head. */
  readonly endpoint?: string;
  /** The socket sent another block at the newest height: the block there was replaced. */
  readonly isReorg?: boolean;
}

/** Hands on each new block of one chain, by subscription where it can, else by polling. */
export interface BlockSource {
  /**
   * Calls `onHead` with each block number above every one before, as soon as it is seen, and how
   * it was seen, until the signal aborts; a socket's head at the newest height with another hash
   * is handed on again as a reorganisation. It never fails for the chain: a dead socket gives way to polling, and a
   * poll no endpoint answers is tried again a block time later. Rejects with the signal's reason
   * once it aborts.
   */
  run(onHead: (number: bigint, seen?: SeenHead) => void, signal: AbortSignal): Promise<void>;
  /** How the source reads now. */
  state(): BlockSourceState;
}

/** What a block source reads with. */
export interface BlockSourceOptions {
  /** The chain's failover, which a poll asks `eth_blockNumber` through. */
  readonly rpc: RpcFailover;
  readonly clock: Clock;
  /** The chain's block time: a poll every block time. */
  readonly blockTimeMs: number;
  /**
   * How long one endpoint may take to answer a poll before the next is asked; the failover's own
   * timeout when absent. A reader of every block wants one well under the failover's.
   */
  readonly callTimeoutMs?: number;
  /** The WebSocket endpoint that pushes new heads, when the chain's config names one. */
  readonly subscription?: HeadSubscription;
}

interface SourceRun {
  readonly options: BlockSourceOptions;
  /** Records a head; answers whether it is above every head seen. */
  readonly see: (
    number: bigint,
    from: {
      readonly mode: BlockSourceState["mode"];
      readonly endpoint?: string;
      readonly hash?: Hex;
    },
  ) => boolean;
  readonly fail: (fault: BlockSourceFault) => void;
  readonly signal: AbortSignal;
  /** When the subscription may be tried again. */
  readonly retryAtMs: () => number;
  /** Keeps the subscription off until then. */
  readonly restUntil: (atMs: number) => void;
}

async function pollOnce(run: SourceRun): Promise<void> {
  const { options, signal } = run;
  try {
    const reply = await options.rpc.request({
      method: "eth_blockNumber",
      params: [],
      result: quantitySchema,
      signal,
      ...(options.callTimeoutMs === undefined ? {} : { timeoutMs: options.callTimeoutMs }),
    });
    if (reply.kind === "result") {
      run.see(reply.value, { mode: "polling", endpoint: reply.endpoint });
    } else {
      run.fail("rpc_down");
    }
  } catch (error) {
    signal.throwIfAborted();
    // No endpoint answered, or one answered with an error: the next poll asks again.
    if (!(error instanceof BinferenceError)) {
      throw error;
    }
    run.fail("rpc_down");
  }
}

async function follow(run: SourceRun, subscription: HeadSubscription): Promise<void> {
  const { clock } = run.options;
  const ended = await followHeads(
    {
      subscription,
      clock,
      onHead: (number, hash) =>
        run.see(number, { mode: "subscription", ...(hash === undefined ? {} : { hash }) }),
    },
    run.signal,
  );
  run.fail(ended);
  run.restUntil(clock.now() + subscription.restMs);
}

// One step: the subscription when it may be tried, else one poll, the next a block time after
// this one began.
async function step(run: SourceRun): Promise<void> {
  const { subscription, clock, blockTimeMs } = run.options;
  if (subscription !== undefined && clock.now() >= run.retryAtMs()) {
    await follow(run, subscription);
    return;
  }
  const startedMs = clock.now();
  await pollOnce(run);
  await clock.sleep(Math.max(0, startedMs + blockTimeMs - clock.now()), run.signal);
}

// The source's state once it saw a head. A head by polling ends a poll's fault; the socket's stays
// until a socket gives heads.
function stateAfter(
  current: BlockSourceState,
  seen: {
    readonly number: bigint;
    readonly mode: BlockSourceState["mode"];
    readonly nowMs: number;
  },
): BlockSourceState {
  const isFaultCleared = seen.mode === "subscription" || current.fault === "rpc_down";
  const fault = isFaultCleared ? undefined : current.fault;
  const isNew = current.head === undefined || seen.number > current.head;
  const { head = seen.number, headAtMs = seen.nowMs } = isNew ? {} : current;
  return { mode: seen.mode, head, headAtMs, ...(fault === undefined ? {} : { fault }) };
}

function endpointOf(from: { readonly endpoint?: string }): SeenHead | undefined {
  return from.endpoint === undefined ? undefined : { endpoint: from.endpoint };
}

// Whether a socket's head at the newest height carries another hash than the head before.
function isReplaced(hashes: { readonly last?: Hex | undefined }, hash: Hex | undefined): boolean {
  return hash !== undefined && hashes.last !== undefined && hash !== hashes.last;
}

/**
 * Creates the block source of one chain (ARCHITECTURE.md section 9). With a WebSocket endpoint it
 * subscribes to `newHeads` and polls only while the socket is dead, for the subscription's rest,
 * before it opens a new one. A socket that brings no head above every head seen within its
 * timeout, such as one whose node repeats a head or trails the chain, counts as dead. Without one,
 * it polls `eth_blockNumber` once a block time through the chain's failover, which moves to the
 * next endpoint within the call timeout. A head that is not above the newest seen, such as a node
 * behind the others, is not handed on, but a socket's head at the newest height with another hash
 * is, as a reorganisation, so the watcher reads that block again.
 */
export function createBlockSource(options: BlockSourceOptions): BlockSource {
  let current: BlockSourceState = {
    mode: options.subscription === undefined ? "polling" : "subscription",
  };
  return {
    async run(onHead, signal) {
      signal.throwIfAborted();
      let retryAtMs = options.clock.now();
      const hashes: { last?: Hex | undefined } = {};
      const sourceRun: SourceRun = {
        options,
        signal,
        retryAtMs: () => retryAtMs,
        restUntil: (atMs) => {
          retryAtMs = atMs;
        },
        see: (number, from) => {
          const isNew = current.head === undefined || number > current.head;
          const isReorg = !isNew && number === current.head && isReplaced(hashes, from.hash);
          current = stateAfter(current, { number, mode: from.mode, nowMs: options.clock.now() });
          if (isNew || isReorg) {
            hashes.last = from.hash;
            onHead(number, isReorg ? { isReorg } : endpointOf(from));
          }
          return isNew;
        },
        fail: (fault) => {
          current = { ...current, mode: "polling", fault };
        },
      };
      await repeatSteps(async () => {
        await step(sourceRun);
        return undefined;
      });
    },
    state: () => current,
  };
}
