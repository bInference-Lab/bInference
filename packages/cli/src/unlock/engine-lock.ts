import { ok, type Result, type Secret } from "@binference/core";
import type { LockReason, UnlockedKeys } from "./unlock-keys.js";

/** One unlock: the owner's passphrase in the `manual` mode, and the caller's signal. */
export interface UnlockCall {
  readonly passphrase?: Secret;
  readonly signal: AbortSignal;
}

/**
 * Whether the engine holds the agent key (decision 0103), and the one way to open it: at start,
 * and through `engine/unlock` after it.
 */
export interface EngineLock {
  isLocked(): boolean;
  /**
   * Opens the keys and hands them to the step that uses them; the engine unlocks once that step
   * resolves. Answers why it stays locked, and `ok` at once, reading nothing, once unlocked.
   * Calls run one at a time. A step that rejects leaves the engine locked and rejects the call.
   */
  unlock(call: UnlockCall): Promise<Result<void, LockReason>>;
}

/** What the lock opens the keys with, and where they go. */
export interface EngineLockOptions {
  /** Reads the agent key and the Privy app secret through the unlock mode. */
  readonly open: (call: UnlockCall) => Promise<Result<UnlockedKeys, LockReason>>;
  /** Takes the opened keys: the step that starts the signer and custody with them. */
  readonly onUnlocked: (keys: UnlockedKeys, signal: AbortSignal) => Promise<void>;
}

/** Creates the {@link EngineLock}, locked. */
export function createEngineLock(options: EngineLockOptions): EngineLock {
  const state = { isLocked: true, turn: Promise.resolve() };
  const attempt = async (call: UnlockCall): Promise<Result<void, LockReason>> => {
    if (!state.isLocked) {
      return ok(undefined);
    }
    const opened = await options.open(call);
    if (!opened.ok) {
      return opened;
    }
    await options.onUnlocked(opened.value, call.signal);
    state.isLocked = false;
    return ok(undefined);
  };
  return {
    isLocked: () => state.isLocked,
    unlock: async (call) => {
      const run = state.turn.then(async () => attempt(call));
      state.turn = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}
