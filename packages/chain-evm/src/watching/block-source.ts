import { BinferenceError, type Clock } from "@binference/core";
import { quantitySchema } from "../rpc/evm-wire.schema.js";
import { requestResult } from "../rpc/request-result.js";
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

/** Hands on each new block of one chain, by subscription where it can, else by polling. */
export interface BlockSource {
  /**
   * Calls `onHead` with each block number above every one before, as soon as it is seen, until
   * the signal aborts. It never fails for the chain: a dead socket gives way to polling, and a
   * poll no endpoint answers is tried again a block time later. Rejects with the signal's reason
   * once it aborts.
   */
  run(onHead: (number: bigint) => void, signal: AbortSignal): Promise<void>;
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
  /** The WebSocket endpoint that pushes new heads, when the chain's config names one. */
  readonly subscription?: HeadSubscription;
}

interface SourceRun {
  readonly options: BlockSourceOptions;
  readonly see: (number: bigint, mode: BlockSourceState["mode"]) => void;
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
    const number = await requestResult(options.rpc, {
      method: "eth_blockNumber",
      params: [],
      result: quantitySchema,
      signal,
    });
    run.see(number, "polling");
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
    { subscription, clock, onHead: (number) => run.see(number, "subscription") },
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

/**
 * Creates the block source of one chain (ARCHITECTURE.md section 9). With a WebSocket endpoint it
 * subscribes to `newHeads` and polls only while the socket is dead, for the subscription's rest,
 * before it opens a new one; without one, it polls `eth_blockNumber` once a block time through the
 * chain's failover, which moves to the next endpoint within its timeout. A head that is not above
 * the newest seen, such as a node behind the others or a reorganised height, is not handed on.
 */
export function createBlockSource(options: BlockSourceOptions): BlockSource {
  let current: BlockSourceState = {
    mode: options.subscription === undefined ? "polling" : "subscription",
  };
  return {
    async run(onHead, signal) {
      signal.throwIfAborted();
      let retryAtMs = options.clock.now();
      const sourceRun: SourceRun = {
        options,
        signal,
        retryAtMs: () => retryAtMs,
        restUntil: (atMs) => {
          retryAtMs = atMs;
        },
        see: (number, mode) => {
          // A head by polling ends a poll's fault; the socket's stays until a socket gives heads.
          const fault =
            mode === "subscription" || current.fault === "rpc_down" ? undefined : current.fault;
          const kept = fault === undefined ? {} : { fault };
          const isNew = current.head === undefined || number > current.head;
          const { head = number, headAtMs = options.clock.now() } = isNew ? {} : current;
          current = { mode, head, headAtMs, ...kept };
          if (isNew) {
            onHead(number);
          }
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
