import type { ProtocolClient } from "@binference/client";
import { BinferenceError, jsonValueSchema } from "@binference/core";
import { displayOutsideText } from "@binference/i18n";
import { operations, type PluginReview, pluginReviewSchema } from "@binference/protocol";
import { z } from "zod";
import { createNpmRegistry, npmRegistry } from "../plugins/npm-registry.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import type { PluginAddFlags } from "../program/plugin-flags.schema.js";
import { useConfigRoute } from "./config-route.js";
import { withEngineWithin } from "./connect-engine.js";
import {
  type JobEnd,
  jobEndOrError,
  type JobEnds,
  reportJobFailure,
  watchJobEnds,
} from "./job-ends.js";
import { pluginReviewLines } from "./plugin-review-lines.js";

// A fetch, its checks and the plugin's first start take a while: the command waits 5 minutes.
const addBudgetMs = 5 * 60_000;
const sourcePattern = /^npm:((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@([^@\s]+)$/;

// The version's npm integrity: the one `--hash` gives, else the one npm answers with.
async function integrityOf(run: CommandRun, source: string, flags: PluginAddFlags) {
  if (flags.hash !== undefined) {
    return flags.hash;
  }
  const [, name, version] = sourcePattern.exec(source) ?? [];
  if (name === undefined || version === undefined) {
    return undefined;
  }
  const { host } = run;
  const download = host.download;
  if (download === undefined) {
    return undefined;
  }
  const signal = AbortSignal.timeout(30_000);
  // npm is reached as the engine reaches it: through the owner's proxy when config names one.
  await useConfigRoute(host, signal);
  const registry = createNpmRegistry({ download, base: host.npmRegistry ?? npmRegistry });
  const read = await registry.version(name, version, signal);
  return read.ok ? read.value.integrity : undefined;
}

interface AddArgs {
  readonly source: string;
  readonly hash: string;
  readonly accepted?: string;
  readonly typedName?: string;
}

async function addOnce(
  client: ProtocolClient,
  ends: JobEnds,
  call: { readonly args: AddArgs; readonly signal: AbortSignal },
): Promise<JobEnd | Error> {
  const { job } = await client.call("plugin/add", call.args, { signal: call.signal });
  return jobEndOrError(ends, job, call.signal);
}

// The review a job ended with, when it ended waiting for one.
function reviewOf(end: JobEnd): PluginReview | undefined {
  if (end.kind !== "failed" || end.push.error.code !== "plugin.review_needed") {
    return undefined;
  }
  try {
    const parsed = pluginReviewSchema.safeParse(
      JSON.parse(String(end.push.error.details?.["review"])),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** What the owner answered the review: the digest, with the name for a plugin with no provenance. */
type Consent =
  | { readonly accepted: string; readonly typedName?: string }
  | "declined"
  | "unanswered";

async function askName(
  run: CommandRun,
  review: PluginReview,
  flags: PluginAddFlags,
): Promise<Consent> {
  const plugin = review.plugin;
  if (flags.name !== undefined) {
    return flags.name === plugin ? { accepted: review.digest, typedName: plugin } : "declined";
  }
  const { prompter } = run.host;
  if (prompter === undefined || flags.json) {
    run.output.fail({
      code: "cli.needs_confirmation",
      key: "plugin.needsName",
      values: { plugin },
    });
    return "unanswered";
  }
  const typed = await prompter.ask({
    id: "pluginName",
    message: run.formatter.message("cli.plugin.askName", { plugin }),
  });
  return typed.trim() === plugin ? { accepted: review.digest, typedName: plugin } : "declined";
}

// Asks the owner after the review: a plugin without provenance takes its typed name, one with it
// a yes. `--yes` stands for the yes, never for the name.
async function consentOf(
  run: CommandRun,
  review: PluginReview,
  flags: PluginAddFlags,
): Promise<Consent> {
  if (review.provenance === "none") {
    return askName(run, review, flags);
  }
  if (flags.yes) {
    return { accepted: review.digest };
  }
  const { prompter } = run.host;
  if (prompter === undefined || flags.json) {
    run.output.fail({ code: "cli.needs_confirmation", key: "plugin.needsYes" });
    return "unanswered";
  }
  const say = (key: string): string =>
    run.formatter.message(`plugin.${key}`, { previous: review.widens?.from ?? "" });
  const widens = review.widens !== undefined;
  const answer = await prompter.choose({
    id: "pluginReview",
    message: run.formatter.message("cli.plugin.askAdd"),
    options: [
      { value: "accept", label: say(widens ? "widen.accept" : "review.accept") },
      { value: "decline", label: say(widens ? "widen.decline" : "review.decline") },
    ],
    initial: "decline",
  });
  return answer === "accept" ? { accepted: review.digest } : "declined";
}

function reportEnd(run: CommandRun, end: JobEnd | Error): ExitCode {
  const { output } = run;
  if (end instanceof Error) {
    const isStopped = end instanceof BinferenceError && end.code.startsWith("client.");
    const key = isStopped ? "plugin.engineStopped" : "plugin.stillRunning";
    output.fail({ code: isStopped ? "engine.stopping" : "engine.timeout", key });
    return 1;
  }
  if (end.kind === "failed") {
    reportJobFailure(output, end.push);
    return 1;
  }
  const plugin = operations["plugin/enable"].result.parse(end.push.result);
  output.json(jsonValueSchema.parse(z.encode(operations["plugin/enable"].result, plugin)));
  const values = {
    plugin: displayOutsideText(plugin.name, 64),
    version: displayOutsideText(plugin.version, 64),
  };
  output.say(plugin.state === "enabled" ? "plugin.added" : "plugin.addedOff", values);
  return 0;
}

/**
 * `binference plugin add npm:<package>@<version>` (decision 0348): asks the engine to add the
 * plugin through `plugin/add` with the version's npm integrity, from `--hash` or else npm's own
 * answer. An update inside its old acceptance installs at once. Otherwise the engine answers its
 * permission review, which the command shows in the owner's language before it asks: a yes for a
 * plugin with npm provenance (`--yes` answers it), the plugin's typed name for one without
 * (`--name` gives it to a script). Then it adds the plugin with the review's digest. With `--json`
 * it prints the review, and the plugin once added.
 */
export async function runPluginAdd(
  run: CommandRun,
  chosen: { readonly options: PluginAddFlags; readonly source: string },
): Promise<ExitCode> {
  const { host, output } = run;
  const { options, source } = chosen;
  if (!sourcePattern.test(source)) {
    output.fail({ code: "protocol.bad_args", key: "plugin.badSource" });
    return 1;
  }
  const hash = await integrityOf(run, source, options);
  if (hash === undefined) {
    output.fail({ code: "plugin.fetch_failed", key: "plugin.hashUnread" });
    return 1;
  }
  return withEngineWithin(host, output, {
    budgetMs: addBudgetMs,
    use: async (client, signal) => {
      const ends = watchJobEnds(client, host.clock);
      try {
        const first = await addOnce(client, ends, { args: { source, hash }, signal });
        const review = first instanceof Error ? undefined : reviewOf(first);
        if (review === undefined) {
          return reportEnd(run, first);
        }
        output.json(jsonValueSchema.parse({ review }));
        for (const line of pluginReviewLines(run.formatter, review)) {
          output.line(line);
        }
        const consent = await consentOf(run, review, options);
        if (consent === "unanswered") {
          return 1;
        }
        if (consent === "declined") {
          output.say("plugin.notAdded");
          return 0;
        }
        return reportEnd(
          run,
          await addOnce(client, ends, { args: { source, hash, ...consent }, signal }),
        );
      } finally {
        ends.close();
      }
    },
  });
}
