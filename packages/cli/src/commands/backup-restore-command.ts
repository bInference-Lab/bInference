import { acquireFileLock, removePath } from "@binference/platform";
import { prepareRestore } from "../attach/prepare-restore.js";
import type { Unpacked } from "../attach/restore-backup.js";
import { type StateSwap, swapInRestored } from "../backups/state-swap.js";
import type { InitContext } from "../init/init-context.js";
import type { StartFlags } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { initContextOf, type Report, refuse } from "./init-command.js";
import {
  isEngineRunning,
  isHomeMoved,
  type ServiceRun,
  serviceStatusOf,
} from "./service-start-command.js";
import { runStart } from "./start-command.js";
import { stopEngine, withStopRun } from "./stop-command.js";

/** What `binference backup restore` was asked: the backup file, and the `--set` of the start after. */
export interface BackupRestoreRequest {
  readonly file: string;
  readonly options: StartFlags;
}

/** How the engine ran before the restore, and so how it starts after it. */
type EngineRun = "service" | "foreground" | "stopped";

async function howItRuns(run: ServiceRun): Promise<EngineRun> {
  if (!isHomeMoved(run.host) && (await serviceStatusOf(run))?.state === "running") {
    return "service";
  }
  return isEngineRunning(run.platform) ? "foreground" : "stopped";
}

// Stops the engine as `binference stop` does and answers how it ran; undefined when it still runs
// once the stop's time is up.
async function stopFor(run: CommandRun): Promise<EngineRun | undefined> {
  const how: { ran: EngineRun | undefined } = { ran: undefined };
  await withStopRun(run.host, run.output, async (stopping) => {
    const ran = await howItRuns(stopping);
    const isLate = ran !== "stopped" && (await stopEngine(stopping)).kind === "late";
    how.ran = isLate ? undefined : ran;
    return 0;
  });
  return how.ran;
}

// Puts the restored files in place under the engine lock; undefined when an engine holds it.
async function swapUnderLock(
  context: InitContext,
  unpacked: Unpacked,
): Promise<StateSwap | undefined> {
  const { platform, host, signal } = context;
  const lock = acquireFileLock(platform.stateFolder.engineLock);
  if (!lock.ok) {
    return undefined;
  }
  try {
    return await swapInRestored(platform.stateFolder, unpacked.unpacked, {
      permissions: platform.permissions,
      atMs: host.clock.now(),
      signal,
    });
  } finally {
    lock.value.release();
  }
}

// Starts the engine as it ran: the background service again, here in the foreground, or not at all.
async function startAsBefore(
  run: CommandRun,
  context: InitContext,
  start: { readonly ran: EngineRun; readonly options: StartFlags },
): Promise<ExitCode> {
  const { ran, options } = start;
  if (ran === "stopped") {
    context.prompter.say(context.words("restore.startYourself"));
    return 0;
  }
  const isForeground = ran === "foreground";
  context.prompter.say(context.words(isForeground ? "restore.startHere" : "restore.startService"));
  return runStart(run.host, run.output, { ...options, isForeground });
}

// Stops the engine and puts the checked backup in place; answers how the engine ran, or the exit
// code of a refusal.
async function stopAndSwap(
  run: CommandRun,
  context: InitContext,
  unpacked: Unpacked,
): Promise<EngineRun | ExitCode> {
  const report: Report = { output: run.output, formatter: run.formatter, isJson: false };
  const folder = context.platform.stateFolder.root;
  const ran = await stopFor(run);
  if (ran === undefined) {
    return refuse(context, report, {
      code: "engine.still_running",
      key: "refused.restoreStopLate",
      values: { folder },
    });
  }
  const swap = await swapUnderLock(context, unpacked);
  if (swap === undefined) {
    return refuse(context, report, {
      code: "engine.already_running",
      key: "refused.restoreEngineStarted",
      values: { folder },
    });
  }
  const when = context.dateTime(unpacked.manifest.createdAt);
  context.prompter.say(
    swap.aside === undefined
      ? context.words("restore.placed", { when })
      : context.words("restore.placedAside", { when, folder: swap.aside }),
  );
  return ran;
}

// Stops the engine and swaps, then removes the folder the backup was unpacked into, whatever came.
async function swapThenClear(
  run: CommandRun,
  context: InitContext,
  unpacked: Unpacked,
): Promise<EngineRun | ExitCode> {
  try {
    return await stopAndSwap(run, context, unpacked);
  } finally {
    await removePath(unpacked.unpacked, context.signal);
  }
}

/**
 * `binference backup restore <file>` (keys spec, section 7.4; decision 0152): restores a backup of
 * this install in the CLI, never in the engine. It asks for the owner key at this terminal, hidden,
 * opens and checks the backup with it, and checks it against Privy while the engine still runs:
 * the same app, the wallets Privy holds for the owner key, and the signer they list now. A refusal
 * changes nothing. Then it stops the engine as `binference stop` does, moves the state it replaces
 * to `replaced/<time>/` for 7 days, puts the backup's files in place under the engine lock, and
 * starts the engine as it ran: the background service again, or here in the foreground for an
 * engine that ran in a terminal, with this run's `--set` flags; an engine that was not running
 * stays stopped. Exits as the start does, or 1 when it refused.
 */
export async function runBackupRestore(
  run: CommandRun,
  request: BackupRestoreRequest,
): Promise<ExitCode> {
  const { options, file } = request;
  const flags = { ...options, isStartOver: false, isAttach: false, restore: file };
  const context = initContextOf(run.host, run.output, { flags, formatter: run.formatter });
  const report: Report = { output: run.output, formatter: run.formatter, isJson: options.json };
  const prepared = await prepareRestore(context, file);
  if (!prepared.ok) {
    return refuse(context, report, prepared.refusal);
  }
  const swapped = await swapThenClear(run, context, prepared.value);
  return typeof swapped === "number"
    ? swapped
    : startAsBefore(run, context, { ran: swapped, options });
}
