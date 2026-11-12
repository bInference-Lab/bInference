import { BinferenceError } from "@binference/core";
import { type HeldLease, holdsLease } from "../leases/agent-leases.js";
import { installSchemas } from "../migrations/install-schemas.js";
import { lockLeaseRows } from "./lease-rows.js";
import type { PostgresConnection } from "./postgres-connection.js";

/** The lease a store host's writes carry: the shared schema of its rows, and the held lease. */
export interface StoreLease {
  readonly sharedSchema: string;
  readonly held: HeldLease;
}

/**
 * The fault of a write whose worker does not hold its install's lease, or whose host carries
 * none. The write changed nothing, and no retry can change that.
 */
export function leaseLost(lease: HeldLease | undefined): BinferenceError {
  if (lease === undefined) {
    return new BinferenceError({
      code: "store.lease_lost",
      message:
        "This store host carries no lease of its install, so it writes nothing. Take the install's lease and open the host with it.",
    });
  }
  return new BinferenceError({
    code: "store.lease_lost",
    message: `This worker no longer holds the lease of install ${lease.installId} under fence ${String(lease.fence)}, so the write changed nothing. Stop the install's engine and runtime now and write nothing more.`,
    details: { installId: lease.installId, fence: lease.fence },
  });
}

/**
 * Refuses, with `store.lease_mismatch`, a lease bound to a schema that is not one of its
 * install's two, so a host can never write one install under another's lease.
 */
export function assertLeaseSchema(lease: StoreLease, schema: string): void {
  const schemas = installSchemas(lease.held.installId);
  if (schema !== schemas.engine && schema !== schemas.agent) {
    throw new BinferenceError({
      code: "store.lease_mismatch",
      message: `The lease names install ${lease.held.installId}, whose schemas are ${schemas.engine} and ${schemas.agent}, not ${schema}. Open the host with that schema's own lease.`,
      details: { installId: lease.held.installId, schema },
    });
  }
}

/**
 * The fence of spec 3, section 6.5, as a write's first statements: reads the install's lease rows
 * `FOR SHARE` in the write's own transaction, then the database's clock, and throws
 * `store.lease_lost` unless there are rows and each names the lease's worker and fence and has not
 * expired. The share locks last until the write ends, so a take, which locks the rows to update
 * them, waits for every write that passed.
 */
export async function checkLease<Schema>(
  connection: PostgresConnection<Schema>,
  lease: StoreLease,
): Promise<void> {
  const at = { sharedSchema: lease.sharedSchema, installId: lease.held.installId };
  const { rows, nowMs } = await lockLeaseRows(connection, at, "share");
  if (!holdsLease(rows, lease.held, nowMs)) {
    throw leaseLost(lease.held);
  }
}
