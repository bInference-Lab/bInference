import type { ProtocolClient } from "@binference/client";
import { BinferenceError } from "@binference/core";
import { z } from "zod";
import type { CommonOptions } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import type { Prompter } from "../term/prompter.js";
import { withEngine } from "./connect-engine.js";

/** What one `engine/unlock` call did, or that the CLI could not make it and said why. */
type Attempt =
  | { readonly kind: "unlocked" }
  | { readonly kind: "locked"; readonly reason: string }
  | { readonly kind: "reported"; readonly code: ExitCode };

const lockedDetails = z.object({ reason: z.string() });
const maxTries = 3;

async function callUnlock(
  client: ProtocolClient,
  passphrase: string | undefined,
  signal: AbortSignal,
): Promise<Attempt> {
  try {
    await client.call("engine/unlock", passphrase === undefined ? {} : { passphrase }, { signal });
    return { kind: "unlocked" };
  } catch (error) {
    const details =
      error instanceof BinferenceError ? lockedDetails.safeParse(error.details) : undefined;
    if (
      error instanceof BinferenceError &&
      error.code === "engine.locked" &&
      details?.success === true
    ) {
      return { kind: "locked", reason: details.data.reason };
    }
    throw error;
  }
}

// Each call connects on its own, so the time a person takes to type never counts against a call.
async function attempt(run: CommandRun, passphrase?: string): Promise<Attempt> {
  const answer: { attempt?: Attempt } = {};
  const code = await withEngine(run.host, run.output, async (client, signal) => {
    answer.attempt = await callUnlock(client, passphrase, signal);
    return 0;
  });
  return answer.attempt ?? { kind: "reported", code };
}

function ended(run: CommandRun, outcome: Attempt): ExitCode {
  if (outcome.kind === "reported") {
    return outcome.code;
  }
  if (outcome.kind === "unlocked") {
    run.output.say("unlock.done");
    run.output.json({ state: "unlocked" });
    return 0;
  }
  const { reason } = outcome;
  run.output.fail({
    code: "engine.locked",
    key: "unlock.failed",
    values: { reason },
    details: { reason },
  });
  return 1;
}

async function askAndUnlock(run: CommandRun, prompter: Prompter, tries: number): Promise<ExitCode> {
  const passphrase = await prompter.ask({
    id: "passphrase",
    message: run.formatter.message("cli.unlock.ask"),
    isSecret: true,
  });
  const outcome = await attempt(run, passphrase);
  if (outcome.kind === "locked" && outcome.reason === "wrong_passphrase" && tries < maxTries) {
    prompter.say(run.formatter.message("cli.unlock.wrong"));
    return askAndUnlock(run, prompter, tries + 1);
  }
  return ended(run, outcome);
}

/**
 * `binference unlock`: opens the agent key of the running engine through `engine/unlock` over IPC
 * (decision 0104). It asks first with no passphrase, which opens every mode but `manual`; when the
 * engine asks for the passphrase, it asks the person at the terminal with hidden input, up to 3
 * tries. No flag takes a passphrase, so with `--yes`, `--json` or nobody at the terminal the
 * `manual` mode is refused. Exits 0 once the engine is unlocked, 1 while it stays locked.
 */
export async function runUnlock(run: CommandRun, options: CommonOptions): Promise<ExitCode> {
  const first = await attempt(run);
  if (first.kind !== "locked" || first.reason !== "needs_passphrase") {
    return ended(run, first);
  }
  const { prompter } = run.host;
  if (prompter === undefined || options.yes || options.json) {
    run.output.fail({ code: "engine.locked", key: "unlock.needsTerminal" });
    return 1;
  }
  return askAndUnlock(run, prompter, 1);
}
