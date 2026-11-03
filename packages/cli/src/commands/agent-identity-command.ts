import type { ProtocolClient } from "@binference/client";
import { reasonNamesOf, unsentReceiptText } from "@binference/i18n";
import type { ProtocolId } from "@binference/protocol";
import type { AgentIdentityFlags } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { withAgent } from "./agent-choice.js";

/** What `binference agent identity` was asked: the agent, and the owner's words about it. */
export interface AgentIdentityRequest {
  readonly options: AgentIdentityFlags;
}

// The agent's registration as binference holds it, said whole; false when it holds none.
async function shownRegistration(
  run: CommandRun,
  client: ProtocolClient,
  call: { readonly agent: ProtocolId<"agent">; readonly signal: AbortSignal },
): Promise<boolean> {
  const { registration } = await client.call("identity/get", { agent: call.agent }, call);
  if (registration === undefined) {
    return false;
  }
  const { registry, onchainId, txHash, registeredAt } = registration;
  run.output.json({ registration: { registry, onchainId, txHash, registeredAt } });
  run.output.say("identity.registered", {
    id: onchainId,
    registry,
    tx: txHash,
    when: run.formatter.dateTime(registeredAt),
  });
  return true;
}

/**
 * `binference agent identity [--agent <id>] [--description <text>]`: shows the agent's ERC-8004
 * identity when binference holds one; else opens its registration card through
 * `identity/register` (decision 0335), which the owner confirms with `binference confirm` or a
 * tap on any surface. A registration that ends before its card, such as a paper agent's, says why
 * on standard error and exits 1. With `--json` it prints `{ registration }` or
 * `{ intent, state, reason? }`.
 */
export async function runAgentIdentity(
  run: CommandRun,
  request: AgentIdentityRequest,
): Promise<ExitCode> {
  const { output, formatter } = run;
  const { agent: named, description } = request.options;
  return withAgent(run, named, async (client, agent, signal) => {
    if (await shownRegistration(run, client, { agent, signal })) {
      return 0;
    }
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
