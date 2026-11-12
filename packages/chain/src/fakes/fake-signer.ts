import { err, type Id, ok } from "@binference/core";
import { type AccountRef, accountRefParts } from "../caip/account-ref.js";
import type { Signer } from "../ports.js";
import type { DaySumsRefusal, SignerLock, SignOutcome } from "../sign-outcome.js";
import type { SignRequest } from "../sign-request.js";
import { signFake } from "./fake-signing-scheme.js";

/**
 * A signer for tests, shaped like a signer service: it holds each wallet's account, signs as the
 * fake family expects, refuses a wallet once its owner removed the signer from it, and answers
 * over the user's 24-hour sums or locked as a test sets it.
 */
export interface FakeSigner extends Signer {
  /** Removes this signer from a wallet, as its owner may at any time; later signing is refused. */
  removeFrom(wallet: Id<"wal">): void;
  /** Answers every later signature `over_sums` with these sums, or signs again once `undefined`. */
  fillSums(sums: DaySumsRefusal | undefined): void;
  /** Answers every later signature `locked` with this reason, or signs again once `undefined`. */
  lock(reason: SignerLock | undefined): void;
}

/** What the fake answers from: its wallets, the ones it was removed from, and what a test set. */
interface FakeView {
  readonly wallets: ReadonlyMap<Id<"wal">, AccountRef>;
  readonly removed: ReadonlySet<Id<"wal">>;
  readonly sums?: DaySumsRefusal;
  readonly lock?: SignerLock;
}

function signedOf(state: FakeView, request: SignRequest): SignOutcome {
  const account = state.wallets.get(request.wallet);
  if (account === undefined) {
    return err("unknown_wallet");
  }
  const { lock, sums } = state;
  if (lock !== undefined) {
    return { ...err("locked"), lock };
  }
  if (sums !== undefined) {
    return { ...err("over_sums"), sums };
  }
  const refused = state.removed.has(request.wallet) || request.tx.from !== account;
  return refused ? err("refused") : ok(signFake(request.tx, accountRefParts(account).address));
}

/** Creates a {@link FakeSigner} that holds the given wallets, each with its one account. */
export function createFakeSigner(wallets: ReadonlyMap<Id<"wal">, AccountRef>): FakeSigner {
  const removed = new Set<Id<"wal">>();
  const answers: { sums?: DaySumsRefusal; lock?: SignerLock } = {};
  return {
    async account(wallet, chain, options) {
      options.signal.throwIfAborted();
      const account = wallets.get(wallet);
      const onChain = account !== undefined && accountRefParts(account).chain === chain;
      return await Promise.resolve(onChain ? ok(account) : err("unknown_wallet"));
    },
    async signTransaction(request, options) {
      options.signal.throwIfAborted();
      return await Promise.resolve(signedOf({ wallets, removed, ...answers }, request));
    },
    removeFrom: (wallet) => {
      removed.add(wallet);
    },
    fillSums: (sums) => {
      if (sums === undefined) {
        delete answers.sums;
        return;
      }
      answers.sums = sums;
    },
    lock: (reason) => {
      if (reason === undefined) {
        delete answers.lock;
        return;
      }
      answers.lock = reason;
    },
  };
}
