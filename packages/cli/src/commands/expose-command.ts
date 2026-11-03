import { BinferenceError, jsonValueSchema } from "@binference/core";
import { type RemoteView, remoteViewSchema } from "@binference/protocol";
import { z } from "zod";
import { platformOf } from "../compose/engine-locations.js";
import { loadConfig } from "../config/load-config.js";
import type { ExposeFlags } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { systemDefaults } from "../program/system-defaults.js";
import { readTailscale } from "../remote/read-tailscale.js";
import { webhookHttpsPort, webhookMount } from "../remote/remote-handlers.js";
import { findTailscale } from "../remote/tailscale-cli.js";
import { withEngineWithin } from "./connect-engine.js";
import { runExposeOff } from "./expose-off.js";
import { type JobEnd, jobEndOrError, reportJobFailure, watchJobEnds } from "./job-ends.js";

// The job runs a few Tailscale CLI calls of at most 10 seconds each, and reads them back.
const exposeBudgetMs = 90_000;

// The Mini App's address the config records now, before this run changes it.
async function recordedAddress(run: CommandRun, signal: AbortSignal): Promise<string | undefined> {
  const { host } = run;
  const platform = platformOf(host);
  const loaded = await loadConfig({
    file: platform.stateFolder.configFile,
    env: host.env,
    sets: [],
    system: systemDefaults(host.env, platform),
    signal,
  });
  return loaded.ok ? loaded.config.remote.publicUrl : undefined;
}

// The public address the question names: the webhook path on this machine's Tailscale name, as
// the CLI reads it here; `undefined` when it reads none, and the engine's job says why.
async function publicAddress(run: CommandRun): Promise<string | undefined> {
  const state = await readTailscale(await findTailscale(run.host), AbortSignal.timeout(15_000));
  const name = state.kind === "running" ? state.node.name : undefined;
  return name === undefined
    ? undefined
    : `https://${name}:${String(webhookHttpsPort)}${webhookMount}`;
}

// The owner's yes before anything goes public (decision 0340): `--yes`, or the answer at a
// terminal; with neither, nothing changes.
async function isPublicAllowed(run: CommandRun, options: ExposeFlags): Promise<boolean> {
  const { prompter } = run.host;
  if (options.yes) {
    return true;
  }
  if (prompter === undefined || options.json) {
    run.output.fail({ code: "cli.expose_needs_yes", key: "expose.needsYes" });
    return false;
  }
  const url = await publicAddress(run);
  const words = (key: string) =>
    run.formatter.message(`cli.${key}`, url === undefined ? {} : { url });
  const answer = await prompter.choose({
    id: "publishWebhooks",
    message: words(url === undefined ? "expose.askPublicUnnamed" : "expose.askPublic"),
    options: [
      { value: "no", label: words("expose.keepPrivate") },
      { value: "yes", label: words("expose.publish") },
    ],
    initial: "no",
  });
  if (answer !== "yes") {
    run.output.say("expose.kept");
  }
  return answer === "yes";
}

function reportDone(run: CommandRun, view: RemoteView, before: string | undefined): ExitCode {
  const { output } = run;
  output.json(jsonValueSchema.parse(z.encode(remoteViewSchema, view)));
  if (view.miniUrl !== undefined) {
    output.say("expose.mini", { url: view.miniUrl });
  }
  if (view.webhookUrl !== undefined) {
    output.say("expose.webhooks", { url: `${view.webhookUrl}${webhookMount}` });
  }
  if (view.miniUrl !== undefined && before === undefined) {
    output.say("expose.restart", { url: view.miniUrl });
  }
  if (view.miniUrl !== undefined && before !== undefined && before !== view.miniUrl) {
    output.say("expose.addressKept", { url: before, mini: view.miniUrl });
  }
  return 0;
}

function reportEnd(run: CommandRun, end: JobEnd | Error, before: string | undefined): ExitCode {
  if (end instanceof Error) {
    const isStopped = end instanceof BinferenceError && end.code.startsWith("client.");
    run.output.fail({
      code: isStopped ? "engine.stopping" : "engine.timeout",
      key: isStopped ? "expose.engineStopped" : "expose.stillRunning",
    });
    return 1;
  }
  if (end.kind === "failed") {
    reportJobFailure(run.output, end.push);
    return 1;
  }
  return reportDone(run, remoteViewSchema.parse(end.push.result), before);
}

/**
 * `binference expose [--webhooks] [--off]` (decisions 0340 and 0341): publishes the Mini App over
 * Tailscale `serve`, private to the tailnet, through `remote/enable` over IPC, and waits up to 90
 * seconds for its job. `--webhooks` also publishes the webhook path to the internet over `funnel`,
 * once the owner answers yes to a question naming the public address, or with `--yes`; with no
 * terminal and no `--yes`, it changes nothing and exits 1. It prints both addresses, says to run
 * `binference restart` when it wrote the Mini App's address, and says so when `remote.publicUrl`
 * keeps an address the owner set. `--off` runs `runExposeOff`. A failure prints its `remote`
 * code's words and exits 1. With `--json` it prints the `RemoteView`.
 */
export async function runExpose(
  run: CommandRun,
  request: { readonly options: ExposeFlags },
): Promise<ExitCode> {
  const { options } = request;
  if (options.off) {
    return runExposeOff(run);
  }
  if (options.webhooks && !(await isPublicAllowed(run, options))) {
    return 1;
  }
  return withEngineWithin(run.host, run.output, {
    budgetMs: exposeBudgetMs,
    use: async (client, signal) => {
      const before = await recordedAddress(run, signal);
      const ends = watchJobEnds(client, run.host.clock);
      try {
        const args = options.webhooks ? { mini: true, webhooks: true } : { mini: true };
        const { job } = await client.call("remote/enable", args, { signal });
        return reportEnd(run, await jobEndOrError(ends, job, signal), before);
      } finally {
        ends.close();
      }
    },
  });
}
