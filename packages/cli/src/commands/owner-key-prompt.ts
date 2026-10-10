import type { ProtocolClient } from "@binference/client";
import { BinferenceError } from "@binference/core";
import type { CommonOptions } from "../program/cli-flags.schema.js";
import type { ExitCode, StepOutcome } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import type { Prompter } from "../term/prompter.js";
import { withEngine } from "./connect-engine.js";

/** An owner-key command's one call, made with the code the person typed. */
export interface OwnerKeyCall<T> {
  /** The command after `binference`, such as `rescue set`, named when no terminal can ask. */
  readonly command: string;
  /** Calls the operation over IPC with the code; the engine refuses a wrong one. */
  readonly call: (client: ProtocolClient, ownerKey: string, signal: AbortSignal) => Promise<T>;
}

/** What an owner-key command got: the call's answer, or the exit code it ended with. */
export type OwnerKeyOutcome<T> = StepOutcome<T>;

/** One call, a wrong owner key, or the code the CLI reported instead. */
type Attempt<T> =
  | { readonly kind: "done"; readonly value: T }
  | { readonly kind: "wrong_key" }
  | { readonly kind: "reported"; readonly code: ExitCode };

const maxTries = 3;

async function callWith<T>(
  client: ProtocolClient,
  request: { readonly owner: OwnerKeyCall<T>; readonly ownerKey: string },
  signal: AbortSignal,
): Promise<Attempt<T>> {
  try {
    return { kind: "done", value: await request.owner.call(client, request.ownerKey, signal) };
  } catch (error) {
    if (error instanceof BinferenceError && error.code === "wallet.bad_owner_key") {
      return { kind: "wrong_key" };
    }
    throw error;
  }
}

// Each call connects on its own, so the time a person takes to type never counts against a call.
async function attempt<T>(
  run: CommandRun,
  request: { readonly owner: OwnerKeyCall<T>; readonly ownerKey: string },
): Promise<Attempt<T>> {
  const answer: { attempt?: Attempt<T> } = {};
  const code = await withEngine(run.host, run.output, async (client, signal) => {
    answer.attempt = await callWith(client, request, signal);
    return 0;
  });
  return answer.attempt ?? { kind: "reported", code };
}

async function askAndCall<T>(
  run: CommandRun,
  request: { readonly owner: OwnerKeyCall<T>; readonly prompter: Prompter; readonly tries: number },
): Promise<OwnerKeyOutcome<T>> {
  const { owner, prompter, tries } = request;
  const ownerKey = await prompter.ask({
    id: "ownerKey",
    message: run.formatter.message("cli.ownerKey.ask"),
    isSecret: true,
  });
  const outcome = await attempt(run, { owner, ownerKey });
  if (outcome.kind === "wrong_key" && tries < maxTries) {
    prompter.say(run.formatter.message("cli.ownerKey.wrong"));
    return askAndCall(run, { ...request, tries: tries + 1 });
  }
  if (outcome.kind === "done") {
    return { ok: true, value: outcome.value };
  }
  if (outcome.kind === "reported") {
    return { ok: false, code: outcome.code };
  }
  run.output.fail({ code: "wallet.bad_owner_key", key: "ownerKey.wrongEnd" });
  return { ok: false, code: 1 };
}

/**
 * Runs an owner-key command's call (decision 0110): asks the person at the terminal for the owner
 * key code with hidden input, up to 3 tries while the engine answers `wallet.bad_owner_key`, and
 * makes the call over IPC, the only transport the CLI speaks. No flag takes the code, so `--yes`,
 * `--json` or nobody at the terminal is refused before anything is sent. The code is never
 * printed, logged or kept.
 */
export async function withOwnerKey<T>(
  run: CommandRun,
  options: CommonOptions,
  owner: OwnerKeyCall<T>,
): Promise<OwnerKeyOutcome<T>> {
  const { prompter } = run.host;
  if (cannotAskOwnerKey(run, options, owner.command) || prompter === undefined) {
    return { ok: false, code: 1 };
  }
  return askAndCall(run, { owner, prompter, tries: 1 });
}

/**
 * Whether an owner-key command cannot ask for the code: with `--yes`, `--json` or nobody at the
 * terminal it says why, so a command can stop before it reads anything.
 */
export function cannotAskOwnerKey(
  run: CommandRun,
  options: CommonOptions,
  command: string,
): boolean {
  const cannot = run.host.prompter === undefined || options.yes || options.json;
  if (cannot) {
    run.output.fail({
      code: "wallet.bad_owner_key",
      key: "ownerKey.needsTerminal",
      values: { command },
    });
  }
  return cannot;
}
