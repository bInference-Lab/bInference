import { engineServiceName } from "../compose/engine-service.js";
import type { CliHost } from "../program/cli-host.js";
import type { CliOutput, ExitCode } from "../program/cli-output.js";
import { isHomeMoved, type ServiceRun } from "./service-start-command.js";
import { refuseLate, stopEngine, withStopRun } from "./stop-command.js";

// Whether the OS removed the service; a folder `BINFERENCE_HOME` moves never has one.
async function removeService(run: ServiceRun): Promise<boolean> {
  if (isHomeMoved(run.host)) {
    return false;
  }
  return (await run.manager.uninstall(engineServiceName, run.signal)).ok;
}

/**
 * `binference service remove` (decision 0141): stops the engine as `binference stop` does, then has
 * the OS remove the background service, so binference no longer starts at login on this machine.
 * The state folder, the config and the keys stay. A machine with no service, or a state folder
 * `BINFERENCE_HOME` moves, which never has one, only stops its engine; running it again is safe.
 * Exits 0 once nothing runs and no service is left, 1 when the engine still runs. With `--json` it
 * prints `{ state, service }`, the service `removed` or `none`.
 */
export async function runServiceRemove(host: CliHost, output: CliOutput): Promise<ExitCode> {
  return withStopRun(host, output, async (run) => {
    const stopped = await stopEngine(run);
    if (stopped.kind === "late") {
      return refuseLate(run);
    }
    const isRemoved = await removeService(run);
    const folder = run.platform.stateFolder.root;
    output.say(isRemoved ? "serviceRemove.removed" : "serviceRemove.none", { folder });
    output.json({ state: "stopped", service: isRemoved ? "removed" : "none" });
    return 0;
  });
}
