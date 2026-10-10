import { BinferenceError, type Clock } from "@binference/core";
import { pollUntil } from "@binference/platform";
import type { ResultOf } from "@binference/protocol";
import type { CliHost } from "../program/cli-host.js";
import { connectEngine } from "./connect-engine.js";

type EngineStatus = ResultOf<"engine/status">;

/** What the engine answers to `engine/status` now, or `undefined` while nothing answers. */
export async function engineAnswer(
  host: CliHost,
  signal: AbortSignal,
): Promise<EngineStatus | undefined> {
  const connection = await connectEngine(host, signal);
  if (!connection.ok) {
    return undefined;
  }
  try {
    return await connection.client.call("engine/status", {}, { signal });
  } catch {
    return undefined;
  } finally {
    connection.client.close();
  }
}

/** How long to wait, on which clock. */
export interface EngineWait {
  readonly clock: Clock;
  readonly budgetMs: number;
  readonly signal: AbortSignal;
}

/**
 * Asks the engine every 250 ms until it answers past `starting`, at most for the budget, and
 * answers the last status it gave: `starting` when it never got further, `undefined` when it never
 * answered at all.
 */
export async function waitForEngine(
  ask: (signal: AbortSignal) => Promise<EngineStatus | undefined>,
  wait: EngineWait,
): Promise<EngineStatus | undefined> {
  const { clock, signal } = wait;
  const seen: { status: EngineStatus | undefined } = { status: undefined };
  const silent = new BinferenceError({ code: "service.no_answer", message: "No answer." });
  const isDone = async (): Promise<boolean> => {
    const status = await ask(signal);
    seen.status = status ?? seen.status;
    return status !== undefined && status.state !== "starting";
  };
  try {
    await pollUntil(
      clock,
      { isDone, until: clock.now() + wait.budgetMs, failure: () => silent },
      signal,
    );
  } catch (error) {
    if (error !== silent) {
      throw error;
    }
  }
  return seen.status;
}
