import type { RpcFailover } from "../rpc/rpc-call.js";
import type { LogReader } from "../watching/ask-logs.js";
import type { TradeContext } from "./match-trades.js";
import type { PriorReader } from "./read-prior-state.js";

/** What the leader watcher reads one span with. */
export interface LeaderReader extends PriorReader, LogReader {
  readonly context: TradeContext;
  /** The failover the log queries go through, apart from the chain's other reads (decision 0252). */
  readonly logsRpc: RpcFailover;
  /** A node that answers `debug_traceTransaction`, asked once the others pruned the state. */
  readonly tracer?: RpcFailover;
}
