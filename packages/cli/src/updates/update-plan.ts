import { ok } from "@binference/core";
import { holdsRunningFiles } from "@binference/platform";
import type { ReleaseNotes } from "@binference/protocol";
import { platformOf } from "../compose/engine-locations.js";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import { createNpmRegistry, npmRegistry } from "../plugins/npm-registry.js";
import { failed, type Outcome } from "../plugins/outcome.js";
import { sigstoreVerifier } from "../plugins/sigstore-verifier.js";
import type { CliFailure } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { updateUserAgent } from "./find-update.js";
import { installedProgramOf } from "./installed-program.js";
import { keepTarball } from "./kept-files.js";
import { downloadRelease } from "./release-download.js";
import { createReleaseFeed, isNewerVersion, isReleaseForm } from "./release-feed.js";

/** An update ready to run: both versions, the new one's notes, and where each tarball is kept. */
export interface UpdatePlan {
  readonly from: string;
  readonly to: string;
  readonly notes?: ReleaseNotes;
  /** The npm prefix this binference runs from. */
  readonly prefix: string;
  readonly tarballs: { readonly from: string; readonly to: string };
}

/** Why an update changes nothing, or that nothing is newer: how the command ends without one. */
export type NoUpdate =
  | { readonly kind: "refused"; readonly failure: CliFailure }
  | { readonly kind: "up_to_date"; readonly current: string; readonly channel: string };

function refused(code: string, key: string, values: Readonly<Record<string, string>> = {}) {
  return failed<NoUpdate>({ kind: "refused", failure: { code, key, values } });
}

// The release asked for, or the newest on the channel; nothing newer is no update.
async function targetOf(
  run: CommandRun,
  ask: { readonly version?: string; readonly config: BinferenceConfig },
  signal: AbortSignal,
): Promise<Outcome<{ readonly version: string; readonly notes?: ReleaseNotes }, NoUpdate>> {
  const { host } = run;
  const current = host.version;
  const channel = ask.config.updates.channel;
  const registry = host.npmRegistry ?? npmRegistry;
  const userAgent = updateUserAgent(host.version, host.system);
  const feed = createReleaseFeed({ http: host.http, registry, userAgent });
  if (ask.version !== undefined && !isReleaseForm(ask.version)) {
    return refused("update.bad_version", "update.badVersion", { version: ask.version });
  }
  const newest = ask.version === undefined ? await feed.newest(channel, signal) : ok(ask.version);
  if (!newest.ok) {
    return refused("update.registry_unreachable", "update.registryUnreachable");
  }
  const version = newest.value;
  if (version === undefined || !isNewerVersion(version, current)) {
    return ask.version === undefined
      ? failed({ kind: "up_to_date", current, channel })
      : refused("update.not_newer", "update.notNewer", { current, version: ask.version });
  }
  const notes = await feed.notes(version, signal);
  return ok(notes === undefined ? { version } : { version, notes });
}

// Reads, checks and keeps one release's tarball; answers where it is kept.
async function kept(
  run: CommandRun,
  version: string,
  signal: AbortSignal,
): Promise<Outcome<string, NoUpdate>> {
  const { host } = run;
  const { download } = host;
  if (download === undefined) {
    return refused("update.registry_unreachable", "update.registryUnreachable");
  }
  const registry = createNpmRegistry({ download, base: host.npmRegistry ?? npmRegistry });
  const verify = host.bundleVerifier ?? sigstoreVerifier();
  const read = await downloadRelease({ registry, verify }, version, signal);
  if (!read.ok) {
    return refused("update.download_failed", "update.downloadFailed", {
      version,
      reason: read.error,
    });
  }
  const platform = platformOf(host);
  const files = { stateFolder: platform.stateFolder, permissions: platform.permissions, signal };
  return ok(await keepTarball(files, { version, bytes: read.value }));
}

/**
 * Plans an update before anything stops (decision 0356): the program must be an npm install, not
 * on Windows, the
 * release named or the newest on `updates.channel` newer than the running one, and both it and
 * the running release must be on npm with binference's own provenance, their tarballs kept in
 * `updates/`. Answers the plan, or why there is none.
 */
export async function planUpdate(
  run: CommandRun,
  ask: { readonly version?: string; readonly config: BinferenceConfig },
  signal: AbortSignal,
): Promise<Outcome<UpdatePlan, NoUpdate>> {
  const program = installedProgramOf(run.host);
  if (program.kind === "image") {
    return refused("update.image", "update.image");
  }
  if (program.kind === "other") {
    return refused("update.not_npm", "update.notNpm", { folder: program.folder });
  }
  const target = await targetOf(run, ask, signal);
  if (!target.ok) {
    return target;
  }
  const { version: to, notes } = target.value;
  // Windows keeps a loaded native module's files open, so npm cannot replace the package from the
  // process that runs `update` (decision 0356): the owner runs the three steps.
  if (holdsRunningFiles(run.host.system)) {
    return refused("update.windows", "update.windows", { version: to });
  }
  const from = run.host.version;
  const next = await kept(run, to, signal);
  if (!next.ok) {
    return next;
  }
  const back = await kept(run, from, signal);
  if (!back.ok) {
    return back;
  }
  const plan = { from, to, prefix: program.prefix, tarballs: { from: back.value, to: next.value } };
  return ok(notes === undefined ? plan : { ...plan, notes });
}
