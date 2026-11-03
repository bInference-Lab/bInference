import type { ProtocolClient } from "@binference/client";
import { BinferenceError, jsonValueSchema } from "@binference/core";
import { operations, type RemoteDisabled } from "@binference/protocol";
import { z } from "zod";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { withEngineWithin } from "./connect-engine.js";

// `--off` first waits for a publish under way to undo, which may take the job's own 90 seconds.
const offBudgetMs = 120_000;

// The words of a failed `--off`, whose next step is `--off` again, never a publish (decision 0341).
const offFailures: Readonly<Record<string, string>> = {
  "remote.tailscale_missing": "expose.offMissing",
  "remote.logged_out": "expose.offLoggedOut",
  "remote.not_operator": "expose.offNotOperator",
  "remote.not_applied": "expose.offUnread",
};

type Left = NonNullable<RemoteDisabled["stillPublished"]>[number];

// The answer of `remote/disable`, or the code of a refusal that has words of its own here.
async function disabled(
  client: ProtocolClient,
  signal: AbortSignal,
): Promise<RemoteDisabled | string> {
  try {
    return await client.call("remote/disable", {}, { signal });
  } catch (error) {
    const code = error instanceof BinferenceError ? error.code : "";
    if (offFailures[code] === undefined) {
      throw error;
    }
    return code;
  }
}

// The line that names one handler left, with the `tailscale` command that takes it off.
function leftLine(run: CommandRun, left: Left): void {
  const values = {
    port: left.port,
    target: left.target,
    isPublic: left.isPublic ? "yes" : "no",
    command: left.isPublic ? "funnel" : "serve",
  };
  if (left.mount === undefined) {
    run.output.item("expose.offLeftForward", values);
    return;
  }
  run.output.item("expose.offLeftHandler", { ...values, mount: left.mount });
}

/**
 * `binference expose --off` (decision 0341): stops a publish under way, takes off binference's
 * handlers through `remote/disable`, and asks nothing. It names each handler that still publishes
 * the engine's or the webhook listener's port, with the `tailscale` command that takes it off,
 * and exits 1 while any is left. A failure says why in words whose next step is `--off` again.
 * With `--json` it prints the answer of `remote/disable`.
 */
export async function runExposeOff(run: CommandRun): Promise<ExitCode> {
  const { output } = run;
  return withEngineWithin(run.host, output, {
    budgetMs: offBudgetMs,
    use: async (client, signal) => {
      const off = await disabled(client, signal);
      if (typeof off === "string") {
        output.fail({
          code: off,
          key: offFailures[off] ?? "connect.failed",
          values: { code: off },
        });
        return 1;
      }
      output.json(jsonValueSchema.parse(z.encode(operations["remote/disable"].result, off)));
      const left = off.stillPublished ?? [];
      if (left.length === 0) {
        output.say("expose.off");
        return 0;
      }
      output.say("expose.offLeft");
      left.forEach((each) => leftLine(run, each));
      return 1;
    },
  });
}
