import type { DatabaseSync } from "node:sqlite";

/**
 * One forward-only migration, from the file `NNNN_name.ts` in `src/migrations/<database>/`. The
 * runner calls `up` inside a write transaction together with the schema version bump, so a
 * failure rolls all of it back. `up` is synchronous and there is no `down`.
 */
export interface Migration {
  /** The file name without its extension, such as `0001_meta`; its number is its version. */
  readonly name: string;
  up(database: DatabaseSync): void;
}
