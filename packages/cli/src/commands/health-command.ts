import type { CliHost } from "../program/cli-host.js";
import type { CliOutput, ExitCode } from "../program/cli-output.js";
import { withEngine } from "./connect-engine.js";

/**
 * `binference health`: exits 0 when the engine answers `engine/status` over IPC and is ready or
 * locked, and 1 while it starts or when it cannot be reached; a container's health check runs it.
 * A locked engine counts as up, since a restart would leave it locked again. With `--json` it
 * prints the state and the health signals.
 */
export async function runHealth(host: CliHost, output: CliOutput): Promise<ExitCode> {
  return withEngine(host, output, async (client, signal) => {
    const status = await client.call("engine/status", {}, { signal });
    const health = status.health.map(({ signal: name, state }) => ({ signal: name, state }));
    output.json({ state: status.state, health });
    if (status.state === "ready") {
      output.say("health.ready");
      return 0;
    }
    if (status.state === "locked") {
      output.say("health.locked");
      return 0;
    }
    output.explain("health.starting");
    return 1;
  });
}
