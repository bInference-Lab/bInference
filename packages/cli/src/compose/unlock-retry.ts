import { BinferenceError, type Clock, type Logger, type Random, retry } from "@binference/core";
import type { EngineLock } from "../unlock/engine-lock.js";
import type { Closers } from "./closers.js";

/** What retries the signer step after a start that found Privy out of reach. */
export interface UnlockRetryOptions {
  readonly lock: Pick<EngineLock, "unlock">;
  readonly clock: Clock;
  /** Draws each wait's random share. */
  readonly random: Random;
  /** Where the retry adds what stops it. */
  readonly closers: Closers;
  readonly logger: Logger;
  /** Tells every surface that the retries are spent and the engine stays locked. */
  readonly onGiveUp: () => void;
}

// Decision 0119: the start's own attempt and five more, the waits capped at 10, 20, 40, 80 and 160
// seconds, all within five minutes of the start.
const policy = { attempts: 6, baseDelayMs: 10_000, maxDelayMs: 160_000, budgetMs: 300_000 };

function stillUnreachable(): BinferenceError {
  return new BinferenceError({
    code: "custody.privy_unreachable",
    message: "Privy is still out of reach, so the engine stays locked.",
    retryable: true,
  });
}

// One attempt: the first is the start's own, which found Privy out of reach. A later one runs the
// signer step again; only Privy out of reach is worth another.
async function attemptUnlock(
  options: UnlockRetryOptions,
  attempt: { readonly attempt: number; readonly signal: AbortSignal },
): Promise<boolean> {
  if (attempt.attempt === 1) {
    throw stillUnreachable();
  }
  const unlocked = await options.lock.unlock({ signal: attempt.signal });
  if (!unlocked.ok && unlocked.error === "custody_unreachable") {
    throw stillUnreachable();
  }
  return unlocked.ok;
}

async function retryUnlock(options: UnlockRetryOptions, stop: AbortSignal): Promise<void> {
  const { clock, random, logger } = options;
  try {
    const isUnlocked = await retry(async (attempt) => attemptUnlock(options, attempt), {
      ...policy,
      signal: stop,
      clock,
      random,
    });
    logger.info(isUnlocked ? "engine.unlock_retried" : "engine.unlock_retry_stopped");
  } catch (error) {
    if (stop.aborted) {
      return;
    }
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    logger.warn("engine.unlock_retry_spent", { errorCode });
    options.onGiveUp();
  }
}

/**
 * Retries the signer step in the background after a start that found Privy out of reach
 * (decision 0119): up to five more attempts, each wait a random share of 10, 20, 40, 80 and 160
 * seconds, within five minutes of the start. A retry that unlocks announces it as
 * `binference unlock` does; one that fails for another reason stops the retries, and the engine
 * stays locked with that reason. Once the retries are spent, `onGiveUp` tells every surface. An
 * unlock by hand ends them too, since the next attempt finds the engine unlocked. Its closer stops
 * it at shutdown.
 */
export function startUnlockRetry(options: UnlockRetryOptions): void {
  const stop = new AbortController();
  const running = retryUnlock(options, stop.signal);
  options.closers.add("unlock retry", async () => {
    stop.abort();
    await running;
  });
}
