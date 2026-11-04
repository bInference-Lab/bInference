import { BinferenceError, createDeadline } from "@binference/core";
import type { EngineState } from "@binference/protocol";
import { checkFindings } from "../commands/check-command.js";
import { useConfigRoute } from "../commands/config-route.js";
import { type EngineRun, engineRunOf, stopFor } from "../commands/engine-runs.js";
import { engineAnswer } from "../commands/wait-for-engine.js";
import { platformOf } from "../compose/engine-locations.js";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import type { CliFailure, ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { loadHostConfig } from "../program/load-host-config.js";
import type { UpdateFlags } from "../program/update-flags.schema.js";
import { proxyEnvOf } from "../skills/fetch-proxy.js";
import { isLiveTradeAnswered } from "../state/live-trade.js";
import { failingChecks, installedChecks, newFailures } from "./check-verdict.js";
import { type HoldOutcome, holdForUpdate, keptRunOf } from "./hold-for-update.js";
import { installArgs, installTarball } from "./install-tarball.js";
import { fixInstalledConfig, startInstalled } from "./installed-commands.js";
import { endUnfinished } from "./unfinished-update.js";
import { endPassed, rollBack, type UpdateEnding, type UpdateFailure } from "./update-endings.js";
import { holdUpdateLock } from "./update-lock.js";
import { planUpdate, type UpdatePlan } from "./update-plan.js";

// Two downloads, a backup, npm's install, a start and a check: on a slow line, minutes. A
// rollback runs on a clock of its own.
const updateBudgetMs = 30 * 60_000;

/** What the update works with besides the plan: the config, npm's variables and the deadline. */
interface UpdateRun {
  readonly run: CommandRun;
  readonly config: BinferenceConfig;
  readonly npmEnv: Readonly<Record<string, string | undefined>>;
  readonly sets: readonly string[];
  readonly signal: AbortSignal;
}

function fail(run: CommandRun, failure: CliFailure): ExitCode {
  run.output.fail(failure);
  return 1;
}

const holdRefusals: {
  readonly [K in Exclude<HoldOutcome["kind"], "held">]: {
    readonly code: string;
    readonly key: string;
  };
} = {
  locked: { code: "engine.already_running", key: "update.locked" },
  sending: { code: "intent.executing", key: "update.busy" },
  unreadable: { code: "store.unreadable", key: "update.unreadable" },
  backup_failed: { code: "backup.failed", key: "update.backupFailed" },
};

// The engine as it ran before a refusal of the held state, so nothing changed after all; the
// words say when it did not start again.
async function refuseHeld(
  update: UpdateRun,
  ran: EngineRun,
  held: Exclude<HoldOutcome, { readonly kind: "held" }>,
): Promise<ExitCode> {
  const isStarted =
    ran === "service" ? await startInstalled(update.run.host, update.sets, update.signal) : true;
  const failure = held.kind === "backup_failed" ? held.failure : "";
  fail(update.run, { ...holdRefusals[held.kind], values: { failure } });
  if (!isStarted) {
    update.run.output.say("update.notStarted");
  }
  return 1;
}

// The new version's verdict: started as the service, it must answer as that version, locked while
// it is judged; then it fails no check the old one passed. Answers why it failed, if it did.
async function judge(ending: UpdateEnding, before: readonly string[]) {
  const { run, ran, plan } = ending;
  const { signal } = ending.state;
  await fixInstalledConfig(run.host, signal);
  if (ran === "service") {
    const isStarted = await startInstalled(run.host, ending.sets, signal);
    const status = isStarted ? await engineAnswer(run.host, signal) : undefined;
    if (status?.version !== plan.to || status.state !== "locked") {
      return { kind: "start" } as const;
    }
  }
  run.output.say("update.checking", { version: plan.to });
  const after = await installedChecks(run.host, signal).catch(() => undefined);
  if (after === undefined) {
    return { kind: "unread" } as const;
  }
  const checks = newFailures(before, after);
  return checks.length === 0 ? undefined : ({ kind: "checks", checks } as const);
}

// Installs the new release and judges it; any fault on the way rolls back on its own clock.
async function installAndJudge(ending: UpdateEnding, before: readonly string[]) {
  const { run, plan, state } = ending;
  const install = { prefix: plan.prefix, tarball: plan.tarballs.to, env: ending.npmEnv };
  const failure: UpdateFailure | undefined = await (async () => {
    const isInstalled = await installTarball(run.host, install, state.signal);
    return isInstalled ? judge(ending, before) : { kind: "install" as const };
  })().catch(() => ({ kind: "interrupted" as const }));
  return failure === undefined ? endPassed(ending) : rollBack(ending, failure);
}

// How the engine answers now, so a restart after a pass can be held to it.
async function stateBefore(update: UpdateRun, ran: EngineRun): Promise<EngineState | undefined> {
  return ran === "service"
    ? (await engineAnswer(update.run.host, update.signal))?.state
    : undefined;
}

// Stops the engine, holds the state, installs the new release and judges it.
async function applyPlan(update: UpdateRun, plan: UpdatePlan): Promise<ExitCode> {
  const { run, signal } = update;
  if (await isLiveTradeAnswered(run.host, signal)) {
    return fail(run, { code: "intent.executing", key: "update.busy" });
  }
  const ran = await engineRunOf(run);
  if (ran === "foreground") {
    return fail(run, { code: "update.foreground", key: "update.foreground" });
  }
  const before = failingChecks(await checkFindings({ host: run.host, fix: false, signal }));
  const engineBefore = await stateBefore(update, ran);
  if (ran !== "stopped" && (await stopFor(run)) === undefined) {
    const folder = platformOf(run.host).stateFolder.root;
    return fail(run, { code: "engine.still_running", key: "stop.late", values: { folder } });
  }
  const state = { host: run.host, config: update.config, signal };
  const held = await holdForUpdate(state, { from: plan.from, to: plan.to });
  if (held.kind !== "held") {
    return refuseHeld(update, ran, held);
  }
  const command = ["npm", ...installArgs(plan.prefix, plan.tarballs.from)].join(" ");
  const backup = held.backup.id;
  run.output.say("update.installing", { version: plan.to, backup, previous: plan.from, command });
  const { npmEnv, sets } = update;
  const known = engineBefore === undefined ? {} : { before: engineBefore };
  const ending = { run, plan, state, ran, npmEnv, sets, backup, isOldOnDisk: false, ...known };
  return installAndJudge(ending, before);
}

// The config, and npm's variables by the owner's proxy, which the route of every request follows.
async function prepare(
  run: CommandRun,
  signal: AbortSignal,
): Promise<Omit<UpdateRun, "run" | "signal" | "sets"> | CliFailure> {
  const loaded = await loadHostConfig(run.host, signal);
  if (!loaded.ok) {
    return { code: "config.invalid", key: "update.configInvalid" };
  }
  const npmEnv = proxyEnvOf(await useConfigRoute(run.host, signal));
  return npmEnv.ok
    ? { config: loaded.config, npmEnv: npmEnv.value }
    : { code: "update.proxy_held", key: "update.proxyHeld" };
}

async function updateOnce(run: CommandRun, flags: UpdateFlags, signal: AbortSignal) {
  const prepared = await prepare(run, signal);
  if ("code" in prepared) {
    return fail(run, prepared);
  }
  const update = { run, ...prepared, sets: flags.sets, signal };
  const unfinished = await endUnfinished(update);
  if (unfinished !== undefined) {
    return unfinished;
  }
  const ask = flags.to === undefined ? prepared : { ...prepared, version: flags.to };
  const planned = await planUpdate(run, ask, signal);
  if (planned.ok) {
    return applyPlan(update, planned.value);
  }
  const ended = planned.failure;
  if (ended.kind === "refused") {
    return fail(run, ended.failure);
  }
  run.output.json({ outcome: "up_to_date", current: ended.current, channel: ended.channel });
  run.output.say("update.upToDate", { current: ended.current, channel: ended.channel });
  return 0;
}

// One update at a time: the update lock, held for the whole run; a fault ends with the step that
// takes the update up again, never with the engine stopped and no word.
async function updateLocked(run: CommandRun, flags: UpdateFlags, signal: AbortSignal) {
  const lock = await holdUpdateLock(keptRunOf({ host: run.host, signal }));
  if (lock === undefined) {
    return fail(run, { code: "update.running", key: "update.running" });
  }
  try {
    return await updateOnce(run, flags, signal);
  } catch (error) {
    const code = error instanceof BinferenceError ? error.code : "unexpected";
    return fail(run, { code: "update.interrupted", key: "update.interrupted", values: { code } });
  } finally {
    lock.release();
  }
}

/**
 * `binference update` (decision 0356): installs the newest release on `updates.channel`, or the
 * one `--to` names, when it is newer than the running one. One runs at a time, under the update
 * lock, and it first ends what an earlier one left. It runs only for an npm install, and not on
 * Windows yet; reads and checks both releases' tarballs and their npm provenance before anything
 * stops; refuses while a live trade is on its way or the engine runs in another terminal; stops
 * the engine, takes a `before_update` backup and copies the closed databases and `config.json5`;
 * installs the new tarball, moves the config to its version, starts the engine through the service,
 * locked while it is judged, and runs the new version's own `check`. A check it fails that the old
 * version passed, an engine that does not answer as the new version, or a fault puts the old
 * version and the copies back. `--set` flags go to every start. With `--json` it prints the
 * outcome. Exits 0 once updated or up to date, else 1.
 */
export async function runUpdate(
  run: CommandRun,
  request: { readonly options: UpdateFlags },
): Promise<ExitCode> {
  const deadline = createDeadline({
    clock: run.host.clock,
    signal: new AbortController().signal,
    timeoutMs: updateBudgetMs,
  });
  try {
    return await updateLocked(run, request.options, deadline.signal);
  } finally {
    deadline.clear();
  }
}
