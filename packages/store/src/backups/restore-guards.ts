import type { InstallGuards } from "@binference/engine/backups";
import type { StoreHost } from "../tasks/store-host.js";
import { carryGuardsTask, readGuardsTask } from "./install-guards-tasks.js";

/** What a restore reads from, and writes into, an `engine.sqlite` (keys spec, section 7.4). */
export interface RestoreGuards {
  /** What the database must never loosen, as it is at `nowMs`. */
  read(nowMs: number, options: { readonly signal: AbortSignal }): Promise<InstallGuards>;
  /**
   * Carries the replaced state's guards into this database, the restored one, in one transaction,
   * and answers its guards as they are then.
   */
  carry(
    current: InstallGuards,
    nowMs: number,
    options: { readonly signal: AbortSignal },
  ): Promise<InstallGuards>;
}

/** A restore's reads and writes on one open `engine.sqlite`. */
export function createRestoreGuards(host: StoreHost): RestoreGuards {
  return {
    read: async (nowMs, options) => host.run(readGuardsTask, nowMs, options),
    carry: async (current, nowMs, options) =>
      host.run(carryGuardsTask, { current, nowMs }, options),
  };
}
