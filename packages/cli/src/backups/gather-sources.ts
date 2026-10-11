import { join } from "node:path";
import { BinferenceError } from "@binference/core";
import { listFolderFiles } from "@binference/platform";
import { agentWorker, snapshotDatabase } from "@binference/store";
import type { BackupParts } from "./backup-parts.js";
import type { ArchivedFile } from "./write-backup.js";

/** The files one backup holds, and the agent database's schema version when it has one. */
export interface GatheredSources {
  readonly files: readonly ArchivedFile[];
  readonly agentSchemaVersion?: number;
}

function snapshotFault(file: string): BinferenceError {
  return new BinferenceError({
    code: "backup.snapshot_failed",
    message: `The snapshot of ${file} found its target taken; the work folder was not fresh.`,
    details: { file },
  });
}

/**
 * Gathers what a backup holds (keys spec, section 7.1): `VACUUM INTO` snapshots of
 * `engine.sqlite`, from the engine's open handle, and of `agent.sqlite` when it exists, both
 * into the fresh `work` folder, never the live files; then `config.json5` and every file under
 * `workspace/`, read in place. The agent key and the app secret, in `keys/` or a keychain, are
 * never among them.
 */
export async function gatherSources(
  parts: BackupParts,
  work: string,
  signal: AbortSignal,
): Promise<GatheredSources> {
  const folder = parts.stateFolder;
  const engineCopy = join(work, "engine.sqlite");
  const engine = await parts.engineDatabase.vacuumInto(engineCopy, { signal });
  if (!engine.ok) {
    throw snapshotFault(folder.engineDatabase);
  }
  const agentCopy = join(work, "agent.sqlite");
  const agent = await snapshotDatabase({
    file: folder.agentDatabase,
    worker: agentWorker,
    target: agentCopy,
    execArgv: parts.workerExecArgv,
    signal,
  });
  if (!agent.ok && agent.error === "target_exists") {
    throw snapshotFault(folder.agentDatabase);
  }
  const workspace = await listFolderFiles(folder.workspace, signal);
  const files: ArchivedFile[] = [
    { path: "engine.sqlite", from: engineCopy },
    ...(agent.ok ? [{ path: "agent.sqlite", from: agentCopy }] : []),
    { path: "config.json5", from: folder.configFile },
    ...workspace.map((path) => ({
      path: `workspace/${path}`,
      from: join(folder.workspace, ...path.split("/")),
    })),
  ];
  return agent.ok ? { files, agentSchemaVersion: agent.value.schemaVersion } : { files };
}
