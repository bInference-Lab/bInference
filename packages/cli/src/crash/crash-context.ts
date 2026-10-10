/**
 * Where the crash suite's global setup left its chain, and how many runs each kill point gets.
 * Every crash test receives it through Vitest's `inject("crash")`.
 */
export interface CrashContext {
  /** anvil's JSON-RPC endpoint: a chain of its own with BSC's chain id, mined only on demand. */
  readonly rpcUrl: string;
  /** Runs per kill point: `BINFERENCE_CRASH_RUNS`, one when it is unset. */
  readonly runs: number;
}

declare module "vitest" {
  interface ProvidedContext {
    readonly crash: CrashContext;
  }
}
