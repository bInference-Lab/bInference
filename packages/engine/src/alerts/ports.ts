import type { Id, Result } from "@binference/core";
import type { AlertFireDraft, AlertFireWritten } from "./alert-fire.js";
import type {
  AlertDelete,
  AlertExpiry,
  AlertHeld,
  AlertQuery,
  AlertRecord,
} from "./alert-record.js";

/** What every store call takes: a call on an aborted signal rejects and changes nothing. */
interface StoreCall {
  readonly signal: AbortSignal;
}

/**
 * Keeps the agents' alerts and a record of each fire (database spec, `alerts` and `alert_fires`).
 * A fire stores its `inbox/alertFired` wake-up in the agent inbox in the same write, so a wake-up
 * and the record of its fire land together or not at all. No call of this store reaches the money
 * path: an alert never moves funds.
 */
export interface AlertStore {
  /**
   * Stores a new active alert. An unknown agent is `not_found`; an agent that holds 50 active
   * alerts `too_many`; a wallet alert whose account would be the 51st tracked across the install,
   * counting the active wallet alerts of agents not archived, `track_limit`. Each stores nothing.
   * An id in use throws `store.constraint`.
   */
  create(
    alert: AlertRecord,
    call: StoreCall,
  ): Promise<Result<AlertRecord, "not_found" | "too_many" | "track_limit">>;
  /** One alert in any state, or `undefined` for an unknown id. */
  get(id: Id<"alr">, call: StoreCall): Promise<AlertRecord | undefined>;
  /** The alerts the query names, the oldest first, then by id. */
  list(query: AlertQuery, call: StoreCall): Promise<readonly AlertRecord[]>;
  /** Moves an active alert to `deleted` and answers it; `undefined` when unknown or not active. */
  delete(change: AlertDelete, call: StoreCall): Promise<AlertRecord | undefined>;
  /** Moves each active alert whose expiry came to `ended`, and answers them, earliest first. */
  expire(expiry: AlertExpiry, call: StoreCall): Promise<readonly AlertRecord[]>;
  /** Moves an active alert to `ended` and answers it; `undefined` when unknown or not active. */
  end(change: AlertDelete, call: StoreCall): Promise<AlertRecord | undefined>;
  /**
   * The alerts whose notice hour ended by `atMs` with matches held back, in any state, with how
   * many; the counts are cleared in the same write, so each is told once. At most `limit`.
   */
  heldNotices(expiry: AlertExpiry, call: StoreCall): Promise<readonly AlertHeld[]>;
  /**
   * Records one fire and moves the alert on (`alertFireOf`), with its notice hour, in one write. A fire with a
   * wake-up and no engine skip replaces the alert's last wake-up while it waits untaken; else it
   * stores a new one in the agent's open session, opening `wake.opens` when none is open, unless
   * the agent's alerts stored 10 wake-ups in the last 60 minutes (skipped `hourly`) or the agent
   * holds 200 untaken messages (skipped `busy`). A fire that wakes the agent answers the wake-ups
   * the hourly limit held back since its last one. A fire the alert cannot take (not active, past
   * its expiry, or at another count of fires) is `stale`, and nothing changes. An agent keeps its
   * fire records 7 days, its newest 1,000 at most.
   */
  fire(draft: AlertFireDraft, call: StoreCall): Promise<Result<AlertFireWritten, "stale">>;
}
