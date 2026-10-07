/**
 * Where the fork suite's global setup left the BSC fork. Every fork test receives it through
 * Vitest's `inject("fork")`; anvil listens on 127.0.0.1, so tests never reach the network
 * themselves.
 */
export interface ForkContext {
  /** anvil's JSON-RPC endpoint. */
  readonly rpcUrl: string;
  /** The block the fork was taken at, in decimal: the same block for every test of a run. */
  readonly block: string;
}

declare module "vitest" {
  interface ProvidedContext {
    readonly fork: ForkContext;
  }
}
