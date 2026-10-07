import { setTimeout as sleep } from "node:timers/promises";

/** How the fork suite tries a call that a public node may refuse for a while. */
export interface RetryPlan {
  /** What the call does, for the error that ends the tries. */
  readonly label: string;
  /** The waits before the second and each later try, in milliseconds. */
  readonly waitsMs: readonly number[];
}

/**
 * Runs `attempt` and tries again after each wait while it rejects. BNB Chain's public nodes answer
 * bursts with HTTP 403 and refuse for 10 to 40 seconds, so the waits grow. The last error ends it.
 */
export async function retryFlakes<T>(plan: RetryPlan, attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    const [wait, ...later] = plan.waitsMs;
    if (wait === undefined) {
      throw new Error(`${plan.label} failed on every try.`, { cause: error });
    }
    await sleep(wait);
    return retryFlakes({ ...plan, waitsMs: later }, attempt);
  }
}
