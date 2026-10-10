import { accountRefParts } from "@binference/chain";
import { jsonValueSchema } from "@binference/core";
import { operations, type ResultOf } from "@binference/protocol";
import { z } from "zod";
import type { AgentFlags } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { withEngine } from "./connect-engine.js";

type SafetyStatus = ResultOf<"safety/status">;

/**
 * `binference freeze [--agent <id>]`: the kill switch, through `safety/freeze`. It freezes the
 * agent `--agent` names, or every agent and the install when left out, so every agent made until
 * an unfreeze starts frozen too. Their open cards and unsigned actions are cancelled at once; a
 * transaction already sent finishes. With `--json` it prints `{ agent?, frozenAt }`.
 */
export async function runFreeze(
  run: CommandRun,
  request: { readonly options: AgentFlags },
): Promise<ExitCode> {
  const { host, output, formatter } = run;
  return withEngine(host, output, async (client, signal) => {
    const { agent } = request.options;
    const args = agent === undefined ? {} : { agent };
    const { frozenAt } = await client.call("safety/freeze", args, { signal });
    output.json({ ...args, frozenAt });
    const when = formatter.dateTime(frozenAt);
    output.say(agent === undefined ? "freeze.all" : "freeze.agent", { agent: agent ?? "", when });
    output.say("freeze.undo");
    return 0;
  });
}

/**
 * `binference unfreeze [--agent <id>]`: asks for an unfreeze through `safety/unfreeze` (decision
 * 0128). Nothing unfreezes on the call: the engine opens the unfreeze card of the agent `--agent`
 * names, or of every frozen agent and the install when left out, and the owner confirms it with
 * `binference confirm` or a tap on any surface. With nothing frozen it opens no card. With
 * `--json` it prints `{ intent? }`.
 */
export async function runUnfreeze(
  run: CommandRun,
  request: { readonly options: AgentFlags },
): Promise<ExitCode> {
  const { host, output } = run;
  return withEngine(host, output, async (client, signal) => {
    const { agent } = request.options;
    const answer = await client.call("safety/unfreeze", agent === undefined ? {} : { agent }, {
      signal,
    });
    output.json(answer.intent === undefined ? {} : { intent: answer.intent });
    if (answer.intent === undefined) {
      output.say("unfreeze.nothing");
    } else {
      output.say("unfreeze.opened", { intent: answer.intent });
    }
    return 0;
  });
}

/**
 * `binference rescue`: opens the rescue card through `safety/rescue` (decision 0044): one intent
 * that moves everything every agent wallet holds, except each wallet's gas reserve, to the rescue
 * address, in paper mode too (decision 0100). While a rescue has not ended it answers that one.
 * The owner confirms it with `binference confirm` or a tap on any surface. With `--json` it prints
 * `{ intent, address }`. A missing rescue address or nothing to move is refused with the engine's
 * code.
 */
export async function runRescue(run: CommandRun): Promise<ExitCode> {
  const { host, output } = run;
  return withEngine(host, output, async (client, signal) => {
    const { intent } = await client.call("safety/rescue", {}, { signal });
    const { rescueAddress } = await client.call("safety/status", {}, { signal });
    output.json({ intent, ...(rescueAddress === undefined ? {} : { address: rescueAddress }) });
    const address = rescueAddress === undefined ? "" : accountRefParts(rescueAddress).address;
    output.say("rescue.opened", { intent, address });
    return 0;
  });
}

function printFreeze(run: CommandRun, status: SafetyStatus): void {
  const { output, formatter } = run;
  if (!status.frozen) {
    output.say("safety.calm");
    return;
  }
  if (status.frozenAt !== undefined) {
    output.say("safety.installFrozen", { when: formatter.dateTime(status.frozenAt) });
  }
  output.say("safety.frozenAgents", { count: status.agents?.length ?? 0 });
  for (const frozen of status.agents ?? []) {
    output.item("safety.frozenAgent", {
      agent: frozen.agent,
      when: formatter.dateTime(frozen.frozenAt),
    });
  }
}

function printRescue(run: CommandRun, status: SafetyStatus): void {
  const { output, formatter } = run;
  if (status.rescue !== undefined) {
    output.say("safety.rescue", { intent: status.rescue.intent, state: status.rescue.state });
  }
  if (status.rescueAddress === undefined) {
    output.say("safety.noRescueAddress");
  } else {
    const { address } = accountRefParts(status.rescueAddress);
    output.say("safety.rescueAddress", { address });
  }
  const pending = status.pendingRescueAddress;
  if (pending !== undefined && status.pendingRescueAt !== undefined) {
    output.say("safety.pendingRescue", {
      address: accountRefParts(pending).address,
      when: formatter.dateTime(status.pendingRescueAt),
    });
  }
}

/**
 * `binference safety status`: what `safety/status` reads, from the engine (decision 0128): the
 * install's freeze and each frozen agent with its time, the rescue that has not ended, the rescue
 * address in effect and a new one that waits with when it takes effect. With `--json` it prints
 * the answer as the operation gives it.
 */
export async function runSafetyStatus(run: CommandRun): Promise<ExitCode> {
  const { host, output } = run;
  return withEngine(host, output, async (client, signal) => {
    const status = await client.call("safety/status", {}, { signal });
    output.json(jsonValueSchema.parse(z.encode(operations["safety/status"].result, status)));
    printFreeze(run, status);
    printRescue(run, status);
    return 0;
  });
}
