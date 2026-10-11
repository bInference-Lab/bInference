import type { Clock, Logger, Random } from "@binference/core";
import type { BackupStore } from "@binference/engine/backups";
import type { InstallStore } from "@binference/engine/install";
import type { FilePermissions, StateFolder } from "@binference/platform";
import type { DatabaseHandle } from "@binference/store";

/** What taking a backup reads and writes, for every backup of one engine. */
export interface BackupParts {
  readonly stateFolder: StateFolder;
  /**
   * `engine.sqlite` as the engine holds it open: the snapshot reads it there, and its versions say
   * whether a migration is ahead.
   */
  readonly engineDatabase: Pick<DatabaseHandle, "vacuumInto" | "schemaVersion" | "latestVersion">;
  readonly install: Pick<InstallStore, "installId" | "read">;
  readonly backups: BackupStore;
  readonly permissions: FilePermissions;
  readonly clock: Clock;
  /** Gives each backup's id; the data key and nonce prefix come from the OS CSPRNG instead. */
  readonly random: Random;
  readonly logger: Logger;
  /** This binference's version, which the header and the manifest name. */
  readonly binferenceVersion: string;
  /** Node options for a store worker, such as a TypeScript loader when tests run source. */
  readonly workerExecArgv: readonly string[];
}
