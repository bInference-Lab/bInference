import type { SignRequest } from "@binference/chain";
import { fakeDraft, signFake } from "@binference/chain/testing";
import { createMemoryLogger, type MemoryLogger } from "@binference/core/testing";
import { testAccount } from "../operations/test-engine.js";
import type { EnginePush } from "../pushes/engine-push.js";
import type { RunningExecutor } from "./create-executor.js";
import {
  type BenchOptions,
  type BenchSend,
  type ExecutorBench,
  executorOf,
  flush,
} from "./test-executor.js";

/** An executor started again over a bench's engine and network, after the first one stopped. */
export interface RestartedBench {
  readonly executor: RunningExecutor;
  /** How many intents its `recover` took. */
  readonly recovered: number;
  /** Every signing request custody received after the restart: a recovery makes none. */
  readonly signed: readonly SignRequest[];
  readonly pushes: readonly EnginePush[];
  readonly sends: readonly BenchSend[];
  readonly logger: MemoryLogger;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
// A restart draws its ids from a seed of its own, as a new process draws new random bytes.
const restartSeed = 100;

/**
 * Stops the bench's executor, as a crash would leave the store, and starts a new one over the
 * same engine, stores and network, which recovers at once, as the engine's startup does.
 */
export async function restartBench(
  bench: ExecutorBench,
  options: BenchOptions = {},
): Promise<RestartedBench> {
  await bench.executor.close();
  const signed: SignRequest[] = [];
  const pushes: EnginePush[] = [];
  const sends: BenchSend[] = [];
  const logger = createMemoryLogger({ subsystem: "engine" });
  const notes = {
    signed: (request: SignRequest) => signed.push(request),
    pushed: (push: EnginePush) => pushes.push(push),
    sent: (send: BenchSend) => sends.push(send),
  };
  const parts = { test: bench.test, network: bench.network, logger };
  const executor = executorOf(parts, notes, { idSeed: restartSeed, ...options });
  const recovered = await executor.recover(live());
  await flush();
  return { executor, recovered, signed, pushes, sends, logger };
}

/** What a restarted executor logged, each record as `event:errorCode`. */
export function restartEvents(restarted: RestartedBench): readonly string[] {
  return restarted.logger
    .records()
    .map((record) => `${record.event}:${record.fields.errorCode ?? ""}`);
}

/**
 * Sends a transaction the engine never signed from the test wallet at `nonce`, as another app
 * holding the wallet would, and leaves it for the next block.
 */
export async function sendForeign(bench: ExecutorBench, nonce: number): Promise<void> {
  const draft = fakeDraft(testAccount, { to: "0x0000000e", value: 1n, data: "foreign" });
  const prepared = await bench.network.prepare({ draft, nonce }, live());
  if (!prepared.ok) {
    throw new Error("Expected the foreign draft to prepare.");
  }
  const signed = signFake(prepared.value.unsigned, "0x0000000c");
  await bench.network.send(signed, live());
}
