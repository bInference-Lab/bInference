import type { AccountRef } from "@binference/chain";
import type { ProtocolClient } from "@binference/client";
import { BinferenceError } from "@binference/core";
import { type RescueAddress, rescueAddressOf } from "../init/rescue-step.js";
import type { CommonOptions } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import type { Prompter } from "../term/prompter.js";
import { withEngine } from "./connect-engine.js";

/** What `binference rescue set` was asked: the new rescue address as typed. */
export interface RescueSetRequest {
  readonly options: CommonOptions;
  readonly address: string;
}

/** One `safety/setRescueAddress` call, or the code the CLI reported instead. */
type Attempt =
  | { readonly kind: "set"; readonly effectiveAt: number }
  | { readonly kind: "wrong_key" }
  | { readonly kind: "reported"; readonly code: ExitCode };

const maxTries = 3;

async function callSet(
  client: ProtocolClient,
  args: { readonly address: AccountRef; readonly ownerKey: string },
  signal: AbortSignal,
): Promise<Attempt> {
  try {
    const answer = await client.call("safety/setRescueAddress", args, { signal });
    return { kind: "set", effectiveAt: answer.effectiveAt };
  } catch (error) {
    if (error instanceof BinferenceError && error.code === "wallet.bad_owner_key") {
      return { kind: "wrong_key" };
    }
    throw error;
  }
}

// Each call connects on its own, so the time a person takes to type never counts against a call.
async function attempt(
  run: CommandRun,
  args: { readonly address: AccountRef; readonly ownerKey: string },
): Promise<Attempt> {
  const answer: { attempt?: Attempt } = {};
  const code = await withEngine(run.host, run.output, async (client, signal) => {
    answer.attempt = await callSet(client, args, signal);
    return 0;
  });
  return answer.attempt ?? { kind: "reported", code };
}

function ended(run: CommandRun, shown: string, outcome: Attempt): ExitCode {
  if (outcome.kind === "reported") {
    return outcome.code;
  }
  if (outcome.kind === "wrong_key") {
    run.output.fail({ code: "wallet.bad_owner_key", key: "rescue.wrongKeyEnd" });
    return 1;
  }
  const { effectiveAt } = outcome;
  const isNow = effectiveAt <= run.host.clock.now();
  run.output.say(isNow ? "rescue.current" : "rescue.set", {
    address: shown,
    when: run.formatter.dateTime(effectiveAt),
  });
  return 0;
}

async function askAndSet(
  run: CommandRun,
  request: {
    readonly prompter: Prompter;
    readonly rescue: RescueAddress;
    readonly tries: number;
  },
): Promise<ExitCode> {
  const { prompter, rescue, tries } = request;
  const ownerKey = await prompter.ask({
    id: "ownerKey",
    message: run.formatter.message("cli.rescue.ask"),
    isSecret: true,
  });
  const outcome = await attempt(run, { address: rescue.account, ownerKey });
  if (outcome.kind === "wrong_key" && tries < maxTries) {
    prompter.say(run.formatter.message("cli.rescue.wrongKey"));
    return askAndSet(run, { ...request, tries: tries + 1 });
  }
  return ended(run, rescue.address, outcome);
}

/**
 * `binference rescue set <address>`: asks the engine over IPC to make the address on BNB Chain
 * the new rescue address (decision 0110). It asks the person at the terminal for the owner key
 * code with hidden input, up to 3 tries; no flag takes it, so `--yes`, `--json` or nobody at the
 * terminal is refused before anything is sent. The engine saves the address in every ceiling and
 * makes it take effect 24 hours later; the command says when. Exits 1 when the address is no
 * address on BNB Chain, or the owner key is wrong three times.
 */
export async function runRescueSet(run: CommandRun, request: RescueSetRequest): Promise<ExitCode> {
  const rescue = rescueAddressOf(request.address);
  if (rescue === undefined) {
    run.output.fail({
      code: "protocol.bad_args",
      key: "rescue.badAddress",
      values: { address: request.address },
    });
    return 1;
  }
  const { prompter } = run.host;
  if (prompter === undefined || request.options.yes || request.options.json) {
    run.output.fail({ code: "wallet.bad_owner_key", key: "rescue.needsTerminal" });
    return 1;
  }
  return askAndSet(run, { prompter, rescue, tries: 1 });
}
