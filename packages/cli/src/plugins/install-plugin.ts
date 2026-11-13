import { BinferenceError, type Clock, type Random } from "@binference/core";
import type { QuotaSource } from "@binference/engine/quotas";
import type { PluginFile } from "@binference/plugin-host";
import type { PluginReview } from "@binference/protocol";
import { decideInstall, type InstallAnswers } from "./decide-install.js";
import { type FetchFailure, fetchPlugin } from "./fetch-plugin.js";
import type { BundleVerifier } from "./npm-provenance.js";
import type { NpmRegistry } from "./npm-registry.js";
import { failed, type Outcome } from "./outcome.js";
import type { LockedPlugin } from "./plugin-lock.js";
import { isPluginsFull, pluginsQuotaOf, withinPluginsQuota } from "./plugin-quota.js";
import { type PluginRecords, withPlugin } from "./plugin-records.js";
import type { PluginRunner } from "./plugin-runner.js";
import { type PluginShelf, putPluginInPlace } from "./put-plugin.js";

/** What an install reads, writes and runs. */
export interface InstallParts {
  readonly registry: NpmRegistry;
  readonly verify: BundleVerifier;
  readonly records: PluginRecords;
  readonly shelf: PluginShelf;
  readonly runner: Pick<PluginRunner, "begin" | "run" | "stop" | "offer">;
  /** Makes a plugin's data folder, where the engine makes it. */
  makeData(id: string, signal: AbortSignal): Promise<void>;
  /** A new `plg_` id. */
  newPlugin(): string;
  readonly clock: Clock;
  readonly random: Random;
  /** The install's quotas: how many plugins may be on (decision 0431); none when absent. */
  readonly quotas?: QuotaSource;
}

/** Why an install changed nothing: what the fetch refused, a refusal, or the review it waits for. */
export type InstallFailure =
  | FetchFailure
  | {
      readonly code:
        | "plugin.id_taken"
        | "plugin.invalid"
        | "plugin.too_many"
        | "plugin.install_failed"
        | "quota.plugins";
    }
  | { readonly code: "plugin.review_needed"; readonly review: PluginReview };

/** The version to put in place, its files, and the version it replaces, if any. */
interface Placing {
  readonly entry: LockedPlugin;
  readonly files: readonly PluginFile[];
  readonly installed: LockedPlugin | undefined;
  /** The quota of plugins on, which the lock's change counts again. */
  readonly quota: number | undefined;
}

// Puts an installed version in place of the running one, records it, and runs it when it is on.
// Files that cannot be written leave the installed package as it was, and its version, stopped
// for the move, runs again (decision 0348).
async function putInPlace(
  parts: InstallParts,
  placing: Placing,
  signal: AbortSignal,
): Promise<Outcome<undefined, { readonly code: "plugin.install_failed" }>> {
  const { entry, files, installed, quota } = placing;
  await parts.runner.stop(entry.id);
  try {
    await parts.makeData(entry.id, signal);
    await putPluginInPlace(
      { ...parts.shelf, random: parts.random },
      { id: entry.id, files },
      signal,
    );
  } catch (error) {
    if (signal.aborted || !(error instanceof BinferenceError)) {
      throw error;
    }
    if (installed?.enabled === true) {
      await parts.runner.run(installed);
    }
    return failed({ code: "plugin.install_failed" });
  }
  const next = await parts.records.change(
    (lock) => withPlugin(lock, withinPluginsQuota(lock, entry, quota)),
    signal,
  );
  const startedAll = await parts.runner.begin(next);
  const kept = next.plugins.find(({ id }) => id === entry.id);
  if (!startedAll && kept?.enabled === true) {
    await parts.runner.run(kept);
  }
  await parts.runner.offer(next);
  return { ok: true, value: undefined };
}

/**
 * Installs a community plugin (decision 0348): fetches and checks it, decides with the lock what
 * the owner's answers allow, and, for an install, stops the running version, puts the files in
 * place, makes its data folder, records it in the lock, then runs it when it is on and hands the
 * agent its tools. A review the owner has not given, or a refusal, changes nothing; files that
 * cannot be written end it `plugin.install_failed`, the installed version running on.
 */
export async function installPlugin(
  parts: InstallParts,
  answers: InstallAnswers,
  signal: AbortSignal,
): Promise<Outcome<LockedPlugin, InstallFailure>> {
  const fetched = await fetchPlugin(parts, answers.from, signal);
  if (!fetched.ok) {
    return fetched;
  }
  const lock = await parts.records.read(signal);
  const decided = decideInstall(lock, fetched.value, {
    answers,
    newPlugin: () => parts.newPlugin(),
    now: parts.clock.now(),
  });
  if (decided.kind === "refused") {
    return failed({ code: decided.code });
  }
  if (decided.kind === "review") {
    return failed({ code: "plugin.review_needed", review: decided.review });
  }
  if (decided.kind === "install") {
    const installed = lock.plugins.find(({ id }) => id === decided.entry.id);
    const quota = await pluginsQuotaOf(parts.quotas, signal);
    if (decided.entry.enabled && isPluginsFull(lock, decided.entry, quota)) {
      return failed({ code: "quota.plugins" });
    }
    const files = fetched.value.pkg.files;
    const placing = { entry: decided.entry, files, installed, quota };
    const put = await putInPlace(parts, placing, signal);
    if (!put.ok) {
      return put;
    }
  }
  return { ok: true, value: decided.entry };
}
