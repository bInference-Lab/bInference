import type { JsonValue } from "@binference/core";
import {
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  type Address,
  type TransactionSerialized,
} from "viem";
import type { KillPoint, RelayedSend } from "./crash-chain.js";

/** Which send a kill waits for. */
export interface KillOptions {
  /** The lowest nonce whose send the kill waits for; sends below it go through. Zero when absent. */
  readonly fromNonce?: number;
}

/** A kill the chain waits to run, and how far the engine got towards it. */
export interface Armed {
  readonly point: Exclude<KillPoint, "signed">;
  readonly fromNonce: number;
  /** Settles once the kill ran: what the killed engine asked meanwhile is never answered. */
  readonly done: Promise<void>;
  /** Whether the engine reached the point, so the kill runs or ran. */
  readonly isTaken: () => boolean;
  /** Takes the kill; answers whether this call took it first. */
  readonly take: () => boolean;
  /** Whether a relay passed the bytes on, so the next receipt read is the engine waiting. */
  readonly hasRelayed: () => boolean;
  readonly markRelayed: () => void;
  /** Runs `before`, then the kill; then every request goes through again. */
  readonly fire: (before?: () => Promise<JsonValue>) => Promise<void>;
}

/** One send of signed bytes as a relay received it. */
export interface ReceivedSend {
  readonly relay: string;
  readonly raw: TransactionSerialized;
  readonly isOnChain: boolean;
}

/** What the chain keeps: every send, who waits for the next one, and the kill that waits. */
export interface ChainBook {
  readonly sends: () => readonly RelayedSend[];
  readonly note: (send: ReceivedSend) => Promise<void>;
  readonly nextSend: (from: Address) => Promise<void>;
  readonly armed: () => Armed | undefined;
  readonly arm: (point: Armed["point"], kill: () => Promise<void>, options?: KillOptions) => void;
  readonly disarm: () => void;
  readonly isRefusing: () => boolean;
  readonly refuse: () => void;
  readonly accept: () => void;
  readonly mining: MiningGate;
}

/** Whether the chain mines: a kill that waits for a later step's send pauses it until it fires. */
interface MiningGate {
  /** Mines one round unless mining is paused. */
  readonly round: (mine: () => Promise<JsonValue>) => Promise<void>;
  /** Pauses mining, once the round under way ended. */
  readonly pause: () => Promise<void>;
  readonly resume: () => void;
}

function armedFor(
  point: Armed["point"],
  kill: () => Promise<void>,
  at: { readonly fromNonce: number; readonly onFired: () => void },
): Armed {
  const progress = { isTaken: false, hasRelayed: false };
  const finishing = { finish: (): void => undefined };
  const done = new Promise<void>((resolve) => {
    finishing.finish = resolve;
  });
  return {
    point,
    fromNonce: at.fromNonce,
    done,
    isTaken: () => progress.isTaken,
    take: () => {
      const isFirst = !progress.isTaken;
      progress.isTaken = true;
      return isFirst;
    },
    hasRelayed: () => progress.hasRelayed,
    markRelayed: () => {
      progress.hasRelayed = true;
    },
    fire: async (before) => {
      await before?.();
      await kill();
      at.onFired();
      finishing.finish();
    },
  };
}

function createMiningGate(): MiningGate {
  const state: { isPaused: boolean; round: Promise<void> } = {
    isPaused: false,
    round: Promise.resolve(),
  };
  return {
    round: async (mine) => {
      if (state.isPaused) {
        return;
      }
      state.round = mine().then(() => undefined);
      await state.round;
    },
    pause: async () => {
      state.isPaused = true;
      await state.round.catch(() => undefined);
    },
    resume: () => {
      state.isPaused = false;
    },
  };
}

/** A new book: no send, no kill armed, relays that pass sends on, and mining that runs. */
export function createChainBook(): ChainBook {
  const sends: RelayedSend[] = [];
  const waiters = new Set<{ readonly from: Address; readonly resolve: () => void }>();
  const current: { armed?: Armed; isRefusing: boolean } = { isRefusing: false };
  const mining = createMiningGate();
  const disarm = (): void => {
    delete current.armed;
    mining.resume();
  };
  return {
    sends: () => [...sends],
    note: async ({ relay, raw, isOnChain }) => {
      const from = await recoverTransactionAddress({ serializedTransaction: raw });
      const nonce = parseTransaction(raw).nonce ?? 0;
      sends.push({ relay, hash: keccak256(raw), from, nonce, isOnChain });
      [...waiters]
        .filter((waiter) => waiter.from === from)
        .forEach((waiter) => {
          waiters.delete(waiter);
          waiter.resolve();
        });
    },
    nextSend: async (from) =>
      new Promise((resolve) => {
        waiters.add({ from, resolve });
      }),
    armed: () => current.armed,
    arm: (point, kill, options) => {
      const fromNonce = options?.fromNonce ?? 0;
      current.armed = armedFor(point, kill, { fromNonce, onFired: disarm });
    },
    disarm,
    isRefusing: () => current.isRefusing,
    refuse: () => {
      current.isRefusing = true;
    },
    accept: () => {
      current.isRefusing = false;
    },
    mining,
  };
}
