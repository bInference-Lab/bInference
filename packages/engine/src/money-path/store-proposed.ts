import { BinferenceError, type Id, type IdSource } from "@binference/core";
import type { IntentRequest } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { IntentProposal, IntentStep } from "../intents/state-machine.js";
import { agentStatusOf } from "./agent-status-of.js";
import type { FillProposal } from "./authorize-simulated.js";
import type { Proposer } from "./create-money-path.js";

/**
 * Stores a proposal the state machine passed as a new intent in `proposed`, under a fresh id. An
 * id in use is a fault: ids never repeat.
 */
export async function storeProposed(
  options: { readonly stored: StoredIntents; readonly ids: IdSource },
  intent: {
    readonly request: IntentRequest;
    readonly proposer: Pick<Proposer, "ref">;
    readonly step: IntentStep;
    readonly wallet: Id<"wal">;
  },
  signal: AbortSignal,
): Promise<IntentSnapshot> {
  const { request, proposer, step, wallet } = intent;
  const id = options.ids.next("int");
  const created = await options.stored.create(
    { id, agentId: request.agent, walletId: wallet, request, proposerRef: proposer.ref, step },
    { signal },
  );
  if (!created.ok) {
    throw new BinferenceError({ code: "engine.id_taken", message: "A new intent id was taken." });
  }
  return created.value;
}

/**
 * What the state machine checks of a proposal before anything is stored: a fill runs in its order's
 * mode, whatever its agent's mode is now (decision 0195).
 */
export function proposalOf(
  call: {
    readonly request: IntentRequest;
    readonly proposer: Proposer;
    readonly fill?: FillProposal;
  },
  settings: AgentSettings | undefined,
): IntentProposal {
  const { request, proposer, fill } = call;
  return {
    kind: request.kind,
    proposer: proposer.role,
    isPaper: fill?.isPaper ?? settings?.agent.mode === "paper",
    hasOutsideContent: proposer.hasOutsideContent,
    agentStatus: agentStatusOf(settings),
    ...(fill === undefined ? {} : { fill: fill.authorization }),
  };
}
