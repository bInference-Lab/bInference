import { engineDebugSwitch, type SandboxFailure } from "@binference/plugin-host";
import { builtPluginPrograms, checkPluginSandbox } from "../compose/plugin-sandbox.js";
import type { CheckFinding } from "./check-finding.js";
import { connectEngine } from "./connect-engine.js";
import type { InstallCheck } from "./install-findings.js";

const check = "plugins.sandbox";
// The check's own share of `binference check`'s budget: a probe and a decoy process.
const checkTimeoutMs = 30_000;

// The running engine's debug-signal switch, as its `engine/status` says; an engine that does not
// run is taken to start as the service and the image start it, with the switch.
async function engineArgsOf(run: InstallCheck): Promise<readonly string[]> {
  const connection = await connectEngine(run.host, run.signal);
  if (!connection.ok) {
    return [engineDebugSwitch];
  }
  try {
    const status = await connection.client.call("engine/status", {}, { signal: run.signal });
    return status.debugSignalOff === true ? [engineDebugSwitch] : [];
  } finally {
    connection.client.close();
  }
}

// The next step for each reason the sandbox does not hold: an act Node let through needs a newer
// Node.
const fixes: Readonly<Partial<Record<SandboxFailure, string>>> = {
  engineDebugSignal: "check.pluginSandbox.fixEngine",
  probeFailed: "check.pluginSandbox.fixLauncher",
};

function fixOf(reason: SandboxFailure): string {
  return fixes[reason] ?? "check.pluginSandbox.fixNode";
}

/**
 * `plugins.sandbox` (decisions 0300 and 0343): the probe plugin, run as every community plugin
 * runs, is refused each act the sandbox refuses on this machine, a process started as the engine
 * is opens no debugger at its signal, and the running engine says over IPC that its own debug
 * signal is off. While the sandbox does not hold it warns, naming the first act that went
 * through and its next step: no community plugin can be installed yet, so none is at risk. A run
 * from the source files, which has no built probe, skips it.
 */
export async function pluginSandboxFinding(run: InstallCheck): Promise<CheckFinding> {
  const signal = AbortSignal.any([run.signal, AbortSignal.timeout(checkTimeoutMs)]);
  const programs = run.host.pluginPrograms ?? (await builtPluginPrograms(signal));
  if (programs === undefined) {
    return { check, level: "skip" };
  }
  const checked = await engineArgsOf({ ...run, signal })
    .then(async (engineArgs) => checkPluginSandbox({ ...run, signal }, { programs, engineArgs }))
    .catch(() => ({ ok: false, error: "probeFailed" }) as const);
  if (checked.ok) {
    const message = { key: "check.pluginSandbox.held", values: {} };
    return { check, level: "ok", message, details: { ownUser: checked.value.ownUser } };
  }
  const reason = checked.error;
  const message = { key: "check.pluginSandbox.off", values: { reason } };
  const more = [{ key: fixOf(reason), values: {} }];
  return { check, level: "warn", message, more, details: { reason } };
}
