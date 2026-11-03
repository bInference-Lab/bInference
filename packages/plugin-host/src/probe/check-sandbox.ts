import { err, ok, type Result } from "@binference/core";
import type { CommunityManifest } from "@binference/plugin-sdk/community";
import type { SandboxFailure } from "../host/host-notice.js";
import { openPlugin, type OpenPluginParts } from "../host/open-plugin.js";
import type { PluginFolders } from "../process/plugin-node-arguments.js";
import { type DebugDecoy, engineDebugSwitch } from "./debug-decoy.js";
import { probeId } from "./probe-id.js";
import { probeActs, type ProbeReport, probeReportSchema } from "./probe-outcome.schema.js";

/** The probe plugin's manifest: one tool, no host. */
export const probeManifest: CommunityManifest = {
  api: 1,
  id: probeId,
  kinds: ["data"],
  entry: "sandbox-probe.mjs",
  hosts: [],
  tools: [
    {
      name: "probe",
      description: "Tries each act the sandbox refuses.",
      input: { type: "object", properties: {}, additionalProperties: false },
      output: { type: "object" },
    },
  ],
};

/** What the sandbox check runs with. */
export interface SandboxCheckParts extends Omit<OpenPluginParts, "onRefused"> {
  /** The Node options this engine process runs with. */
  readonly engineArgs: readonly string[];
  /** The probe's folders: the built probe's own, and an empty data folder. */
  readonly folders: PluginFolders;
  /** A file and a folder outside the probe's, which it must not read or write. */
  readonly outside: { readonly file: string; readonly folder: string };
  startDecoy(signal: AbortSignal): Promise<DebugDecoy>;
}

/** A sandbox that holds: whether its plugins also run under an OS user of their own. */
export interface SandboxPass {
  readonly ownUser: boolean;
}

// Acts the report alone does not judge: Node never refuses the debug signal itself, so the
// decoy says whether its debugger opened, and only another user stops a plain signal.
const judgedElsewhere = new Set(["debugSignal", "signal"]);

// The first act the probe was not refused, or the decoy's debugger if the signal opened it.
function failureOf(report: ProbeReport, decoyDebugger: "open" | "closed" | undefined) {
  const open = probeActs.find((act) => !judgedElsewhere.has(act) && report[act] !== "refused");
  if (open !== undefined) {
    return open;
  }
  return decoyDebugger === "closed" ? undefined : "debugSignal";
}

async function probe(parts: SandboxCheckParts, decoy: DebugDecoy, signal: AbortSignal) {
  const config = {
    outsideFile: parts.outside.file,
    outsideFolder: parts.outside.folder,
    decoyPid: decoy.pid,
  };
  const spec = { manifest: probeManifest, folders: parts.folders, config };
  const opened = await openPlugin(spec, { ...parts, onRefused: () => undefined }, signal);
  if (!opened.ok) {
    return undefined;
  }
  const answer = await opened.value.call("probe", {}, signal);
  opened.value.stop();
  const report = answer.ok ? probeReportSchema.safeParse(answer.value) : undefined;
  return report?.success === true ? report.data : undefined;
}

/**
 * The sandbox check, before any community plugin runs (decision 0300, decision 0343): the engine
 * must run with `--disable-sigusr1`, and the probe plugin, started as every plugin is, must be
 * refused each act of `probeActs`; a decoy started as the engine is must not open its debugger
 * at the probe's signal. A signal to the decoy is refused only when the starter runs plugins
 * under an OS user of their own, which it must then be; with the engine's own user it passes and
 * `ownUser` is false, which `binference check` warns of. Answers the first act that held, or
 * `probeFailed` when the decoy or the probe cannot start or answer; it never throws.
 */
export async function checkSandbox(
  parts: SandboxCheckParts,
  signal: AbortSignal,
): Promise<Result<SandboxPass, SandboxFailure>> {
  if (!parts.engineArgs.includes(engineDebugSwitch)) {
    return err("engineDebugSignal");
  }
  const decoy = await parts.startDecoy(signal).catch(() => undefined);
  if (decoy === undefined) {
    return err("probeFailed");
  }
  try {
    // A probe that cannot start or answer, such as with no launcher listening, proves nothing.
    const report = await probe(parts, decoy, signal).catch(() => undefined);
    if (report === undefined) {
      return err("probeFailed");
    }
    const failure = failureOf(report, await decoy.report());
    const ownUser = report.signal === "refused";
    if (failure !== undefined || (parts.starter.ownUser && !ownUser)) {
      return err(failure ?? "signal");
    }
    return ok({ ownUser });
  } finally {
    decoy.kill();
  }
}
