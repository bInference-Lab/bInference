import type { JsonValue } from "@binference/core";
import {
  type RunningEngine,
  type StartRefusal,
  startSelfHosted,
} from "../compose/start-self-hosted.js";
import type { CliHost } from "../program/cli-host.js";
import type { CliOutput, ExitCode } from "../program/cli-output.js";
import { configIssueMessages } from "./config-issue-messages.js";

function issuesOf(refusal: Extract<StartRefusal, { refusal: "config_invalid" }>): JsonValue {
  return refusal.issues.map((issue) => ({
    path: issue.path,
    problem: issue.problem.kind,
    fix: issue.fix,
    layer: issue.origin.layer,
  }));
}

function refuseConfig(
  output: CliOutput,
  refusal: Extract<StartRefusal, { refusal: "config_invalid" }>,
): void {
  output.fail({
    code: "config.invalid",
    key: "start.configInvalid",
    values: { file: "config.json5", count: refusal.issues.length },
    details: issuesOf(refusal),
  });
  for (const issue of refusal.issues) {
    configIssueMessages(issue).forEach(({ key, values }) => output.explain(key, values));
  }
}

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
      refuseConfig(output, refusal);
      break;
  }
  return 1;
}

function announce(output: CliOutput, engine: RunningEngine): void {
  const { host, port } = engine.http;
  output.say("start.ready", { host, port: String(port), ipc: engine.ipc, logFile: engine.logFile });
  output.say("start.missingParts");
  output.json({ state: "ready", http: { host, port }, ipc: engine.ipc, logFile: engine.logFile });
}

/**
 * `binference start`: starts the engine in this process and serves the protocol until a stop
 * signal or `engine/stop` runs the shutdown sequence. Exits 0 when every shutdown step finished,
 * 1 when one did not or the engine refused to start.
 */
export async function runStart(
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
