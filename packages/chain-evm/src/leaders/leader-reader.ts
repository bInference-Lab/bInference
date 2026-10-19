import type { RpcFailover } from "../rpc/rpc-call.js";
import type { TradeContext } from "./match-trades.js";
import type { PriorReader } from "./read-prior-state.js";
import type { LogReader } from "./read-span-logs.js";

/** What the leader watcher reads one span with. */
export interface LeaderReader extends PriorReader, LogReader {
  readonly context: TradeContext;
  /** A node that answers `debug_traceTransaction`, asked once the others pruned the state. */
  readonly tracer?: RpcFailover;
}
