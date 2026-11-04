import { createDeadline } from "@binference/core";
import { fileSize } from "@binference/platform";
import type { EngineState } from "@binference/protocol";
import { type EngineRun, engineRunOf, stopFor } from "../commands/engine-runs.js";
import { engineAnswer } from "../commands/wait-for-engine.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import type { StoppedStateRun } from "../state/stopped-state.js";
import { keptRunOf, putStateBack } from "./hold-for-update.js";
import { installArgs, installTarball } from "./install-tarball.js";
import { startInstalled } from "./installed-commands.js";
import { removeKeptFiles } from "./kept-files.js";
import type { UpdatePlan } from "./update-plan.js";
import { writeUpdateState } from "./update-state.js";

// npm's install of the old release and the start after it, on their own clock: a forward update
// that ran out of time must still be undone.
const rollbackBudgetMs = 20 * 60_000;

/** Why an update goes back, in the words the owner reads. */
export type UpdateFailure =
  | { readonly kind: "checks"; readonly checks: readonly string[] }
  | { readonly kind: "install" | "start" | "unread" | "unfinished" | "restart" | "interrupted" };

/** What an update's ending works on: the command, the plan, the run on the stopped state. */
export interface UpdateEnding {
  readonly run: CommandRun;
  readonly plan: UpdatePlan;
  readonly state: StoppedStateRun;
  /** How the engine ran before the update stopped it, and so how it starts after. */
  readonly ran: EngineRun;
  /** The variables npm runs with: the owner's proxy, and nothing else of it. */
  readonly npmEnv: Readonly<Record<string, string | undefined>>;
  /** The `--set` flags the engine starts with. */
  readonly sets: readonly string[];
  /** The sealed backup taken before the update, for words when nothing else is left. */
  readonly backup: string;
  /** Whether the program on disk is the old release already, so a rollback installs nothing. */
  readonly isOldOnDisk: boolean;
  /** The state the engine answered before the update, which a restart after a pass must match. */
  readonly before?: EngineState;
}

/** Why a rollback stopped before the old version and its data were back. */
type Unfinished = "foreground" | "late" | "held" | "npm" | "tarball" | "copies";

function failureDetails(failure: UpdateFailure) {
  return failure.kind === "checks"
    ? { failed: failure.kind, checks: failure.checks.join(", ") }
    : { failed: failure.kind, checks: "" };
}

// The rollback stopped part way: the record stays `checking`, so every engine stays locked and the
// next `binference update` takes it up from here.
function stopUndo(ending: UpdateEnding, reason: Unfinished): ExitCode {
  const { plan } = ending;
  const tarball = ["npm", ...installArgs(plan.prefix, plan.tarballs.from)].join(" ");
  const named = `npm install --global binference@${plan.from}`;
  ending.run.output.fail({
    code: "update.rollback_failed",
    key: "update.undoStopped",
    values: {
      reason,
      version: plan.to,
      previous: plan.from,
      command: reason === "tarball" ? named : tarball,
      backup: ending.backup,
    },
    details: { from: plan.from, to: plan.to, reason },
  });
  return 1;
}

// Stops whatever engine runs; a foreground one, or one that does not stop, ends the rollback.
async function stopAny(ending: UpdateEnding): Promise<Unfinished | undefined> {
  const now = await engineRunOf(ending.run);
  if (now === "foreground") {
    return "foreground";
  }
  return now === "service" && (await stopFor(ending.run)) === undefined ? "late" : undefined;
}

// Puts the old release back with npm from its kept tarball, unless it is on disk already.
async function installOld(
  ending: UpdateEnding,
  signal: AbortSignal,
): Promise<Unfinished | undefined> {
  if (ending.isOldOnDisk) {
    return undefined;
  }
  const { plan, run } = ending;
  if (!(await fileSize(plan.tarballs.from, signal)).ok) {
    return "tarball";
  }
  const install = { prefix: plan.prefix, tarball: plan.tarballs.from, env: ending.npmEnv };
  const isInstalled = await installTarball(run.host, install, signal);
  return isInstalled ? undefined : "npm";
}

// Stops, installs the old release, puts the data back and records it; what stopped it, if anything.
async function undo(ending: UpdateEnding, signal: AbortSignal): Promise<Unfinished | undefined> {
  const stopped = await stopAny(ending);
  if (stopped !== undefined) {
    return stopped;
  }
  const installed = await installOld(ending, signal);
  if (installed !== undefined) {
    return installed;
  }
  const kept = { ...keptRunOf(ending.state), signal };
  const put = await putStateBack(kept);
  if (put !== "restored") {
    return put === "locked" ? "held" : "copies";
  }
  const { from, to } = ending.plan;
  await writeUpdateState(kept.stateFolder.root, { state: "rolled_back", from, to }, kept);
  return undefined;
}

/**
 * Rolls an update back (decision 0356), on a deadline of its own: stops the engine, has npm
 * install the old release's kept tarball unless it is on disk already, puts the copied databases
 * and `config.json5` back as plain files under the engine lock, records it `rolled_back`, starts
 * the engine through the service when it ran as one, and removes what the update kept. It never
 * starts an engine in this process. When a step cannot finish, nothing kept goes, the record stays
 * `checking`, and the owner gets the step that ends it. Exits 1 either way.
 */
export async function rollBack(ending: UpdateEnding, failure: UpdateFailure): Promise<ExitCode> {
  const { run, plan } = ending;
  const deadline = createDeadline({
    clock: run.host.clock,
    signal: new AbortController().signal,
    timeoutMs: rollbackBudgetMs,
  });
  try {
    const { signal } = deadline;
    const unfinished = await undo(ending, signal);
    if (unfinished !== undefined) {
      return stopUndo(ending, unfinished);
    }
    const isStarted =
      ending.ran === "service" ? await startInstalled(run.host, ending.sets, signal) : false;
    await removeKeptFiles({ ...keptRunOf(ending.state), signal });
    const details = failureDetails(failure);
    run.output.fail({
      code: "update.rolled_back",
      key: "update.rolledBack",
      values: {
        version: plan.to,
        previous: plan.from,
        ...details,
        started: isStarted ? "yes" : "no",
      },
      details: { from: plan.from, to: plan.to, ...details, started: isStarted },
    });
    return 1;
  } finally {
    deadline.clear();
  }
}

// How the restart after a pass went: `back` when the update must roll back, which is safe only
// while the engine never answered or stays locked, so it signed nothing; a locked engine passes
// only as the new version and when the old one was locked too. An engine that answers past the
// lock may have signed, so its data stays.
function restartOf(
  status: Awaited<ReturnType<typeof engineAnswer>>,
  ending: UpdateEnding,
): "back" | "yes" | "starting" {
  if (status === undefined) {
    return "back";
  }
  if (status.state === "locked") {
    const isAsBefore = ending.before === "locked" && status.version === ending.plan.to;
    return isAsBefore ? "yes" : "back";
  }
  return status.state === "ready" ? "yes" : "starting";
}

// Stops the locked engine and starts it through the service; how the restart went.
async function restart(ending: UpdateEnding): Promise<"back" | "yes" | "starting" | "late"> {
  const { run } = ending;
  const { signal } = ending.state;
  if ((await stopFor(run)) === undefined) {
    return "late";
  }
  const isStarted = await startInstalled(run.host, ending.sets, signal);
  return restartOf(isStarted ? await engineAnswer(run.host, signal) : undefined, ending);
}

/**
 * Ends an update that passed (decision 0356): records it `updated` with the release's notes, so
 * the engine opens its keys, then stops it and starts it through the service as it ran, where it
 * tells the owner once. The copies go only once the restarted engine answers as the new version,
 * unlocked unless the old one was locked too; one that never answers, or stays locked when the old
 * one was not, signed nothing, and the update rolls back. A stop that does not finish puts the
 * record back to `checking` and names the next step. An engine that was stopped stays stopped, and
 * the words say its first start runs the new version's migrations. Exits 0 once updated.
 */
export async function endPassed(ending: UpdateEnding): Promise<ExitCode> {
  const { run, plan } = ending;
  const kept = keptRunOf(ending.state);
  const { from, to, notes } = plan;
  const checking = { state: "checking", from, to, backup: ending.backup } as const;
  const updated = notes === undefined ? { from, to } : { from, to, notes };
  await writeUpdateState(kept.stateFolder.root, { state: "updated", ...updated }, kept);
  const started = ending.ran === "service" ? await restart(ending) : "no";
  if (started === "back" || started === "late") {
    await writeUpdateState(kept.stateFolder.root, checking, kept);
    return started === "late" ? stopUndo(ending, "late") : rollBack(ending, { kind: "restart" });
  }
  await removeKeptFiles(kept);
  run.output.json({ outcome: "updated", from, to, started });
  run.output.say("update.done", { version: to, previous: from, started });
  return 0;
}
