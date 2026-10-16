import { BinferenceError, ok } from "@binference/core";
import { acquireFileLock, removePath } from "@binference/platform";
import { prepareRestore } from "../attach/prepare-restore.js";
import type { Unpacked } from "../attach/restore-backup.js";
import {
  carryReplaced,
  confirmRestore,
  type ReplacedState,
  readRestored,
} from "../attach/restore-guards-step.js";
import { type StateSwap, swapInRestored } from "../backups/state-swap.js";
import type { InitContext, InitStep } from "../init/init-context.js";
import type { StartFlags } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { initContextOf, refuse } from "./init-command.js";
import type { Report } from "./init-summary.js";
import {
  isEngineRunning,
  isHomeMoved,
  runServiceStart,
  type ServiceRun,
  serviceStatusOf,
} from "./service-start-command.js";
import { type ForegroundStart, startForeground } from "./start-command.js";
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

/** A swap that happened, or why none did. */
type Swapped =
  | { readonly kind: "swapped"; readonly swap: StateSwap }
  | { readonly kind: "locked" }
  | { readonly kind: "not_carried" }
  | { readonly kind: "put_back" }
  | { readonly kind: "mixed"; readonly aside: string; readonly staged: string };

// What a swap that failed left behind: everything put back, or a folder that mixes two states.
function failedSwap(error: Error): Swapped {
  if (error instanceof BinferenceError && error.code === "backup.restore_rollback_failed") {
    const { aside, staged } = error.details;
    return { kind: "mixed", aside: String(aside), staged: String(staged) };
  }
  return { kind: "put_back" };
}

// Carries the replaced state's guards into the restored copy, then puts the restored files in
// place, all under the engine lock; `locked` when an engine holds it. A swap that fails puts every
// file back before it answers (keys spec, section 7.4).
async function swapUnderLock(
  context: InitContext,
  unpacked: Unpacked,
  replaced: ReplacedState["kind"],
): Promise<Swapped> {
  const { platform, host, signal } = context;
  const lock = acquireFileLock(platform.stateFolder.engineLock);
  if (!lock.ok) {
    return { kind: "locked" };
  }
  try {
    try {
      const { ownerKey } = unpacked;
      await carryReplaced(context, { unpacked: unpacked.unpacked, replaced, ownerKey });
    } catch (error) {
      if (signal.aborted || !(error instanceof BinferenceError)) {
        throw error;
      }
      return { kind: "not_carried" };
    }
    const swap = await swapInRestored(platform.stateFolder, unpacked.unpacked, {
      permissions: platform.permissions,
      atMs: host.clock.now(),
      signal,
    });
    return { kind: "swapped", swap };
  } catch (error) {
    if (signal.aborted || !(error instanceof Error)) {
      throw error;
    }
    return failedSwap(error);
  } finally {
    lock.value.release();
  }
}

// Undoes a swap under the engine lock; answers what was left where when it could not.
async function undoUnderLock(context: InitContext, swap: StateSwap): Promise<Swapped> {
  const lock = acquireFileLock(context.platform.stateFolder.engineLock);
  const folder = context.platform.stateFolder.root;
  if (!lock.ok) {
    return { kind: "mixed", aside: swap.aside ?? folder, staged: folder };
  }
  try {
    await swap.undo();
    return { kind: "put_back" };
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }
    return failedSwap(error);
  } finally {
    lock.value.release();
  }
}

// Says that the state folder mixes two states and where each waits; nothing starts on it, and the
// folder the restored files were staged in stays.
function refuseMixed(
  restore: RestoreRun,
  mixed: { readonly aside: string; readonly staged: string },
): ExitCode {
  const { context, report } = restore;
  restore.staged.keep();
  const folder = context.platform.stateFolder.root;
  return refuse(context, report, {
    code: "backup.restore_rollback_failed",
    key: "refused.restoreMixed",
    values: { folder, aside: mixed.aside, staged: mixed.staged },
  });
}

/** How one run of `binference backup restore` goes on: its command run, words and report. */
interface RestoreRun {
  readonly run: CommandRun;
  readonly context: InitContext;
  readonly report: Report;
  readonly options: StartFlags;
  /** Keeps the staged files once the state folder mixes both states. */
  readonly staged: { readonly keep: () => void; readonly isKept: () => boolean };
}

// Starts the engine as it ran: the background service again, or here in the foreground. A start
// on the restored state that does not reach `ready` or `locked` is undone, and the engine starts
// again as it ran on the state it had; the restore then exits 1.
async function startOrUndo(
  restore: RestoreRun,
  started: { readonly ran: EngineRun; readonly swap: StateSwap },
): Promise<ExitCode> {
  const { context } = restore;
  const { ran, swap } = started;
  if (ran === "stopped") {
    context.prompter.say(context.words("restore.startYourself"));
    return 0;
  }
  const isForeground = ran === "foreground";
  context.prompter.say(context.words(isForeground ? "restore.startHere" : "restore.startService"));
  const first = await startAs(restore, ran);
  if (first.isStarted) {
    return first.serve();
  }
  if (!isForeground) {
    // A service that never answered is stopped already; this waits until it lets go of the lock.
    await stopFor(restore.run);
  }
  const undone = await undoUnderLock(context, swap);
  if (undone.kind === "mixed") {
    return refuseMixed(restore, undone);
  }
  context.prompter.say(context.words("restore.startFailedUndone"));
  const again = await startAs(restore, ran);
  if (again.isStarted) {
    await again.serve();
  }
  return 1;
}

// One start as the engine ran, with this run's `--set` flags.
async function startAs(
  restore: RestoreRun,
  ran: Exclude<EngineRun, "stopped">,
): Promise<ForegroundStart> {
  const { host, output } = restore.run;
  const { sets } = restore.options;
  if (ran === "foreground") {
    return startForeground(host, output, sets);
  }
  const code = await runServiceStart(host, output, sets);
  return code === 0
    ? { isStarted: true, serve: async () => Promise.resolve(0) }
    : { isStarted: false, code };
}

// Refuses a swap that did not happen, after which the engine runs as it did: an engine held the
// lock, the folder mixes both states, or nothing moved and the engine starts again as it ran.
async function refuseSwap(
  restore: RestoreRun,
  swapped: Exclude<Swapped, { readonly kind: "swapped" }>,
  ran: EngineRun,
): Promise<ExitCode> {
  const { context, report } = restore;
  const folder = context.platform.stateFolder.root;
  if (swapped.kind === "locked") {
    return refuse(context, report, {
      code: "engine.already_running",
      key: "refused.restoreEngineStarted",
      values: { folder },
    });
  }
  if (swapped.kind === "mixed") {
    return refuseMixed(restore, swapped);
  }
  const isCarry = swapped.kind === "not_carried";
  const code = refuse(context, report, {
    code: isCarry ? "backup.restore_carry_failed" : "backup.restore_move_failed",
    key: isCarry ? "refused.restoreCarryFailed" : "refused.restoreMoveFailed",
    values: { folder },
  });
  const again = ran === "stopped" ? undefined : await startAs(restore, ran);
  if (again?.isStarted === true) {
    await again.serve();
  }
  return code;
}

// Stops the engine and puts the checked backup in place; answers how the engine ran with the
// swap, or the exit code of a refusal, after which the engine runs as it did.
async function stopAndSwap(
  restore: RestoreRun,
  unpacked: Unpacked,
  replaced: ReplacedState["kind"],
): Promise<{ readonly ran: EngineRun; readonly swap: StateSwap } | ExitCode> {
  const { run, context, report } = restore;
  const ran = await stopFor(run);
  if (ran === undefined) {
    return refuse(context, report, {
      code: "engine.still_running",
      key: "refused.restoreStopLate",
      values: { folder: context.platform.stateFolder.root },
    });
  }
  const swapped = await swapUnderLock(context, unpacked, replaced);
  if (swapped.kind !== "swapped") {
    return refuseSwap(restore, swapped, ran);
  }
  const { swap } = swapped;
  const when = context.dateTime(unpacked.manifest.createdAt);
  context.prompter.say(
    swap.aside === undefined
      ? context.words("restore.placed", { when })
      : context.words("restore.placedAside", { when, folder: swap.aside }),
  );
  return { ran, swap };
}

// Shows the owner what the restore changes while the engine still runs, and asks to go on; answers
// how the state it replaces read, for the carry after the stop.
async function preview(
  context: InitContext,
  unpacked: Unpacked,
): Promise<InitStep<ReplacedState["kind"]>> {
  const { replaced } = unpacked;
  const restored = await readRestored(context, unpacked.unpacked);
  const confirmed = await confirmRestore(context, {
    createdAtMs: unpacked.manifest.createdAt,
    replaced,
    restored,
  });
  return confirmed.ok ? ok(replaced.kind) : confirmed;
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
 * stays stopped. The swap is all or nothing, and a start on the restored state that fails puts
 * the replaced state back and starts the engine on it. The folder the backup was unpacked into
 * goes once the swap is done or undone, and stays when the state folder mixes both. Exits as the
 * start does, or 1 when it refused or undid the restore.
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
  const kept = { isKept: false };
  const staged = {
    keep: () => {
      kept.isKept = true;
    },
    isKept: () => kept.isKept,
  };
  const restore: RestoreRun = { run, context, report, options, staged };
  try {
    const previewed = await preview(context, prepared.value);
    if (!previewed.ok) {
      return refuse(context, report, previewed.refusal);
    }
    const swapped = await stopAndSwap(restore, prepared.value, previewed.value);
    return typeof swapped === "number" ? swapped : await startOrUndo(restore, swapped);
  } finally {
    if (!staged.isKept()) {
      await removePath(prepared.value.unpacked, context.signal);
    }
  }
}
