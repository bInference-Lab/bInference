import type { RunningEngine, StartRefusal } from "../compose/start-outcome.js";
import { startSelfHosted } from "../compose/start-self-hosted.js";
import type { StartFlags } from "../program/cli-flags.schema.js";
import type { CliHost } from "../program/cli-host.js";
import type { CliOutput, ExitCode } from "../program/cli-output.js";
import { refuseConfig } from "./config-refusal.js";
import { runServiceStart } from "./service-start-command.js";

function refuse(output: CliOutput, refusal: StartRefusal): ExitCode {
  switch (refusal.refusal) {
    case "already_running":
      output.fail({
        code: "engine.already_running",
        key: "start.alreadyRunning",
        values: { folder: refusal.folder },
      });
      break;
    case "store_damaged":
      output.fail({
        code: "store.damaged",
        key: "start.storeDamaged",
        values: { file: refusal.file },
      });
      break;
    case "port_taken":
      output.fail({
        code: "server.listen_failed",
        key: "start.portTaken",
        values: { port: String(refusal.port) },
      });
      break;
    case "config_invalid":
      refuseConfig(output, refusal.issues);
      break;
  }
  return 1;
}

function announce(output: CliOutput, engine: RunningEngine): void {
  const { host, port } = engine.http;
  output.say("start.ready", { host, port: String(port), ipc: engine.ipc, logFile: engine.logFile });
  output.say("start.missingParts");
  const { lockReason } = engine;
  if (lockReason !== undefined) {
    output.say("start.locked", { reason: lockReason });
  }
  output.json({
    state: engine.state,
    ...(lockReason === undefined ? {} : { lockReason }),
    http: { host, port },
    ipc: engine.ipc,
    logFile: engine.logFile,
  });
}

/**
 * `binference start --foreground`: starts the engine in this process and serves the protocol
 * until a stop signal or `engine/stop` runs the shutdown sequence. Exits 0 when every shutdown
 * step finished, 1 when one did not or the engine refused to start.
 */
async function runForeground(
  host: CliHost,
  output: CliOutput,
  sets: readonly string[],
): Promise<ExitCode> {
  const started = await startSelfHosted({ host, sets });
  if (!started.ok) {
    return refuse(output, started);
  }
  announce(output, started.engine);
  const report = await started.engine.finished;
  const unfinished = report.steps
    .filter((step) => step.outcome !== "done")
    .map((step) => step.name);
  output.json({ state: "stopped", unfinished });
  if (unfinished.length > 0) {
    output.say("start.stoppedLate", { steps: unfinished.join(", ") });
    return 1;
  }
  output.say("start.stopped");
  return 0;
}

/**
 * `binference start`: runs the engine as the background service, or with `--foreground` in this
 * process, which is what the service itself runs.
 */
export async function runStart(
  host: CliHost,
  output: CliOutput,
  flags: StartFlags,
): Promise<ExitCode> {
  return flags.isForeground
    ? runForeground(host, output, flags.sets)
    : runServiceStart(host, output, flags.sets);
}
