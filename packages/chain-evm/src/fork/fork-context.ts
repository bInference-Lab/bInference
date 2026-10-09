/**
 * Where the fork suite's global setup left the BSC fork. Every fork test receives it through
 * Vitest's `inject("fork")`; both endpoints listen on 127.0.0.1, so tests never reach the network
 * themselves.
 */
export interface ForkContext {
  /** anvil's JSON-RPC endpoint. */
  readonly rpcUrl: string;
  /** The public node anvil forks from; each test file's setup pins the fork there again. */
  readonly upstream: string;
  /** A JSON-RPC endpoint that reads `eth_getLogs` from a public node, for blocks up to `block`. */
  readonly logsRpcUrl: string;
}

declare module "vitest" {
  interface ProvidedContext {
    readonly fork: ForkContext;
  }
}
