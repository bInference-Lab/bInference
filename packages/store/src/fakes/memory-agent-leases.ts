import { type Clock, err, type Id, ok, type Result } from "@binference/core";
import {
  type AgentLeases,
  type HeldLease,
  holdsLease,
  type LeaseRow,
  type LeaseTake,
  leaseTimes,
} from "../leases/agent-leases.js";

/** {@link AgentLeases} of one install in memory, with its rows for a test to read. */
export interface MemoryAgentLeases extends AgentLeases {
  /** Every row of the install: its own first, then each agent's by id. */
  rows(): readonly LeaseRow[];
}

/** What {@link createMemoryAgentLeases} serves. */
export interface MemoryAgentLeasesOptions {
  /** The one install it holds rows for; any other is `not_found`. */
  readonly installId: Id<"ins">;
  /** Its clock, which stands for the database's. */
  readonly clock: Clock;
  /** How far ahead a take or renewal moves the expiry; {@link leaseTimes} by default. */
  readonly leaseMs?: number;
}

interface LeaseState {
  readonly installId: Id<"ins">;
  readonly clock: Clock;
  readonly leaseMs: number;
  readonly rows: Map<string, LeaseRow>;
}

const freeRow: LeaseRow = {
  agentId: "",
  workerId: null,
  fence: 1,
  takenAtMs: null,
  renewedAtMs: null,
  expiresAtMs: 0,
};

function ownRow(state: LeaseState): LeaseRow {
  return state.rows.get("") ?? freeRow;
}

// The rows a lease's worker and fence name; none for another install's lease.
function namedRows(state: LeaseState, lease: HeldLease): readonly LeaseRow[] {
  return lease.installId === state.installId
    ? [...state.rows.values()].filter(
        (row) => row.workerId === lease.workerId && row.fence === lease.fence,
      )
    : [];
}

function holds(state: LeaseState, lease: HeldLease): boolean {
  return (
    lease.installId === state.installId &&
    holdsLease([...state.rows.values()], lease, state.clock.now())
  );
}

function moveExpiry(
  state: LeaseState,
  lease: HeldLease,
  times: { readonly expiresAtMs: number; readonly renewedAtMs?: number },
): void {
  for (const row of namedRows(state, lease)) {
    const renewedAtMs = times.renewedAtMs ?? row.renewedAtMs;
    state.rows.set(row.agentId, { ...row, expiresAtMs: times.expiresAtMs, renewedAtMs });
  }
}

function takeRows(state: LeaseState, take: LeaseTake): Result<HeldLease, "held" | "not_found"> {
  const now = state.clock.now();
  if (take.installId !== state.installId) {
    return err("not_found");
  }
  if ([...state.rows.values()].some((row) => row.expiresAtMs > now)) {
    return err("held");
  }
  const expiresAtMs = now + state.leaseMs;
  for (const row of state.rows.values()) {
    const taken = { workerId: take.workerId, fence: row.fence + 1, takenAtMs: now };
    state.rows.set(row.agentId, { ...row, ...taken, renewedAtMs: now, expiresAtMs });
  }
  return ok({ ...take, fence: ownRow(state).fence, takenAtMs: now, expiresAtMs });
}

function renewRows(state: LeaseState, lease: HeldLease): Result<HeldLease, "lost"> {
  if (namedRows(state, lease).length === 0) {
    return err("lost");
  }
  const now = state.clock.now();
  moveExpiry(state, lease, { expiresAtMs: now + state.leaseMs, renewedAtMs: now });
  return ok({ ...lease, expiresAtMs: now + state.leaseMs });
}

/**
 * The in-memory {@link AgentLeases} of one install, which starts with the install's own row free,
 * as `create_install` makes it. It keeps the rules of the Postgres adapter, on `clock`.
 */
export function createMemoryAgentLeases(options: MemoryAgentLeasesOptions): MemoryAgentLeases {
  const state: LeaseState = {
    installId: options.installId,
    clock: options.clock,
    leaseMs: options.leaseMs ?? leaseTimes.leaseMs,
    rows: new Map([["", freeRow]]),
  };
  const whileHeld =
    (change: (agentId: Id<"agt">) => void) =>
    async (
      lease: HeldLease,
      agentId: Id<"agt">,
      { signal }: { readonly signal: AbortSignal },
    ): Promise<Result<void, "lost">> => {
      signal.throwIfAborted();
      if (!holds(state, lease)) {
        return err("lost");
      }
      change(agentId);
      return ok(undefined);
    };
  return {
    take: async (take, { signal }) => {
      signal.throwIfAborted();
      return takeRows(state, take);
    },
    renew: async (lease, { signal }) => {
      signal.throwIfAborted();
      return renewRows(state, lease);
    },
    stop: async (lease, { signal }) => {
      signal.throwIfAborted();
      moveExpiry(state, lease, { expiresAtMs: state.clock.now() });
    },
    addAgent: whileHeld((agentId) => {
      state.rows.set(agentId, state.rows.get(agentId) ?? { ...ownRow(state), agentId });
    }),
    removeAgent: whileHeld((agentId) => state.rows.delete(agentId)),
    rows: () =>
      [...state.rows.values()].toSorted((left, right) => (left.agentId < right.agentId ? -1 : 1)),
  };
}
