import { reasonNamesOf, unsentReceiptText } from "@binference/i18n";
import type { ProtocolId } from "@binference/protocol";
import type { AgentIdentityFlags } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { chooseAgentFirst } from "./agent-choice.js";
import { withEngine } from "./connect-engine.js";
import { withOwnerKey } from "./owner-key-prompt.js";

/** What `binference agent identity` was asked: the agent, and the owner's words about it. */
export interface AgentIdentityRequest {
  readonly options: AgentIdentityFlags;
}

// The agent's registration as binference holds it, said whole; whether it holds one.
async function shownRegistration(run: CommandRun, agent: ProtocolId<"agent">): Promise<boolean> {
  const held = { isShown: false };
  await withEngine(run.host, run.output, async (client, signal) => {
    const { registration } = await client.call("identity/get", { agent }, { signal });
    if (registration === undefined) {
      return 0;
    }
    const { registry, onchainId, txHash, registeredAt } = registration;
    run.output.json({ registration: { registry, onchainId, txHash, registeredAt } });
    run.output.say("identity.registered", {
      id: onchainId,
      registry,
      tx: txHash,
      when: run.formatter.dateTime(registeredAt),
    });
    held.isShown = true;
    return 0;
  });
  return held.isShown;
}

// The owner's opt-in: the registry's call written into the main wallet's ceiling with the owner
// key typed unseen, which `identity/allow` leaves as it is once the ceiling holds it.
async function optedIn(
  run: CommandRun,
  request: { readonly agent: ProtocolId<"agent">; readonly options: AgentIdentityFlags },
): Promise<ExitCode | undefined> {
  const { agent, options } = request;
  const allowed = await withOwnerKey(run, options, {
    command: "agent identity",
    call: async (client, ownerKey, signal) =>
      client.call("identity/allow", { agent, ownerKey }, { signal }),
  });
  if (!allowed.ok) {
    return allowed.code;
  }
  if (allowed.value.changed) {
    run.output.say("identity.allowed", { wallet: allowed.value.wallet });
  }
  return undefined;
}

// The registration's card, or why it ended before one.
async function registered(
  run: CommandRun,
  request: { readonly agent: ProtocolId<"agent">; readonly description: string | undefined },
): Promise<ExitCode> {
  const { output, formatter } = run;
  const { agent, description } = request;
  return withEngine(run.host, output, async (client, signal) => {
    const args = description === undefined ? { agent } : { agent, description };
    const view = await client.call("identity/register", args, { signal });
    const reason = view.outcome?.reason;
    output.json({
      intent: view.intent,
      state: view.state,
      ...(reason === undefined ? {} : { reason }),
    });
    if (view.state === "awaiting_confirmation") {
      output.say("identity.opened", { intent: view.intent });
      return 0;
    }
    const receipt = unsentReceiptText(formatter, reason, reasonNamesOf(view));
    output.explain("identity.unsent", { intent: view.intent, receipt });
    return 1;
  });
}

/**
 * `binference agent identity [--agent <id>] [--description <text>]`: shows the agent's ERC-8004
 * identity when binference holds one. Else, for a live agent, it asks for the owner key unseen
 * and opts the agent in through `identity/allow`, which writes the registry's call into the main
 * wallet's ceiling (decision 0335), then opens the registration card through `identity/register`,
 * which the owner confirms with `binference confirm` or a tap on any surface. A paper agent gets
 * no opt-in, and its registration ends `paper_only`. A registration that ends before its card
 * says why on standard error and exits 1. With `--json` it prints `{ registration }` or
 * `{ intent, state, reason? }`; the owner key needs a terminal, so a live agent's first
 * registration runs without `--json`.
 */
export async function runAgentIdentity(
  run: CommandRun,
  request: AgentIdentityRequest,
): Promise<ExitCode> {
  const { agent: named, description } = request.options;
  const chosen = await chooseAgentFirst(run, named);
  if (!chosen.ok) {
    return chosen.code;
  }
  const { agent, status } = chosen.value;
  if (await shownRegistration(run, agent)) {
    return 0;
  }
  const refused =
    status?.mode === "paper" ? undefined : await optedIn(run, { agent, options: request.options });
  return refused ?? registered(run, { agent, description });
}
