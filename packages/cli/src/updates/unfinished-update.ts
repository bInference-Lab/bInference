import { engineRunOf } from "../commands/engine-runs.js";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { keptRunOf } from "./hold-for-update.js";
import { installedProgramOf } from "./installed-program.js";
import { keptTarballOf, removeKeptFiles } from "./kept-files.js";
import { rollBack } from "./update-endings.js";
import { readUpdateRecord } from "./update-state.js";

/** What ending an earlier update works with: the command, its config, npm's variables. */
interface UnfinishedRun {
  readonly run: CommandRun;
  readonly config: BinferenceConfig;
  readonly npmEnv: Readonly<Record<string, string | undefined>>;
  readonly sets: readonly string[];
  readonly signal: AbortSignal;
}

function refuse(run: CommandRun, code: string, key: string): ExitCode {
  run.output.fail({ code, key });
  return 1;
}

/**
 * Ends what an earlier update left (decision 0356), under the update lock the caller holds. Once
 * the record is final, `updated` or `rolled_back`, or there is none, the data on disk is the
 * installed version's, so the copies and kept tarballs left by a run that stopped part way go,
 * and it answers `undefined`. While the record says `checking`, the data may be the new version's
 * and the program either one, so it takes the rollback up where it stopped: it stops the engine,
 * has npm put the old release back unless this program is it, puts the copies back under the
 * engine lock and starts the engine through the service when it ran as one. An engine in another
 * terminal is refused, as it is never started from this process; a record that does not read
 * changes nothing. Answers the exit code then.
 */
export async function endUnfinished(unfinished: UnfinishedRun): Promise<ExitCode | undefined> {
  const { run, signal } = unfinished;
  const state = { host: run.host, config: unfinished.config, signal };
  const kept = keptRunOf(state);
  const root = kept.stateFolder.root;
  const record = await readUpdateRecord(root, signal);
  if (record === "unread") {
    return refuse(run, "update.record_unread", "update.recordUnread");
  }
  if (record?.state !== "checking") {
    await removeKeptFiles(kept);
    return undefined;
  }
  const program = installedProgramOf(run.host);
  if (program.kind !== "npm") {
    return refuse(run, "update.not_npm", "update.unfinishedNotNpm");
  }
  const ran = await engineRunOf(run);
  const plan = {
    from: record.from,
    to: record.to,
    prefix: program.prefix,
    tarballs: { from: keptTarballOf(root, record.from), to: keptTarballOf(root, record.to) },
  };
  const ending = {
    run,
    plan,
    state,
    ran,
    npmEnv: unfinished.npmEnv,
    sets: unfinished.sets,
    backup: record.backup ?? "",
    isOldOnDisk: run.host.version === record.from,
  };
  return rollBack(ending, { kind: "unfinished" });
}
