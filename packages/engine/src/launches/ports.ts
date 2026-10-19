import type { ChainRef } from "@binference/chain";
import type { WatchCursorRecord } from "../leaders/tracked-wallet-record.js";
import type { LaunchQuery, LaunchReadRecord, StoredLaunch } from "./launch-record.js";

/** What every store call takes: a call on an aborted signal rejects and changes nothing. */
interface StoreCall {
  readonly signal: AbortSignal;
}

/**
 * Keeps the launches the launch feed read and its cursor (database spec, section 2.6; decisions
 * 0254 to 0256). No call reaches the money path.
 */
export interface LaunchStore {
  /** The launch feed's cursor on a chain, if it stored one. */
  cursor(chain: ChainRef, call: StoreCall): Promise<WatchCursorRecord | undefined>;
  /**
   * Stores one read in one write: each launch once on its chain and token, a token read again in
   * another block moving there; the launches stored in the read's blocks that it no longer holds,
   * which a reorganization removed, deleted; each curve change of a stored launch; the chain's
   * launches older than 90 days deleted; and the cursor at `to`. Answers the launches stored new,
   * in the read's order.
   */
  record(read: LaunchReadRecord, call: StoreCall): Promise<readonly StoredLaunch[]>;
  /** A chain's launches the query asks for, newest first by time, block and log index. */
  list(query: LaunchQuery, call: StoreCall): Promise<readonly StoredLaunch[]>;
}
