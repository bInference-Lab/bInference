import type { Clock } from "@binference/core";
import type { RemoteView } from "@binference/protocol";
import type { CliHost } from "../program/cli-host.js";
import { answersBeyondLoopback } from "./engine-reach.js";
import { readTailscale } from "./read-tailscale.js";
import type { LoopbackPorts } from "./remote-handlers.js";
import { type RemoteRecord, remoteViewOf } from "./remote-view.js";
import { findTailscale } from "./tailscale-cli.js";

/** What a read of remote access needs: the host that runs Tailscale's CLI, the ports, the record. */
export interface RemoteReadParts {
  readonly host: Pick<CliHost, "env" | "programFolders" | "runProgram" | "system">;
  readonly ports: LoopbackPorts;
  /** `remote.mini` and `remote.webhooks` as the config holds them now. */
  readonly record: () => RemoteRecord;
  readonly clock: Clock;
}

/**
 * Reads remote access as `remote/status` and `binference check` show it: Tailscale through its
 * CLI and, with `probeEngine`, whether the engine's port answers beyond loopback. It never
 * throws for what Tailscale answers.
 */
export async function readRemoteView(
  parts: RemoteReadParts,
  options: { readonly probeEngine: boolean; readonly signal: AbortSignal },
): Promise<RemoteView> {
  const { signal } = options;
  const [state, engineAnswers] = await Promise.all([
    findTailscale(parts.host).then(async (run) => readTailscale(run, signal)),
    options.probeEngine ? answersBeyondLoopback(parts.ports.engine, signal) : false,
  ]);
  return remoteViewOf(state, {
    record: parts.record(),
    ports: parts.ports,
    engineAnswers,
    now: parts.clock.now(),
  });
}
