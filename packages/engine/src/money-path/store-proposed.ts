import {
  BinferenceError,
  type Clock,
  err,
  type Id,
  type IdSource,
  ok,
  type Result,
} from "@binference/core";
import type { AssetInfos, IntentRequest, ProtocolErrorCode } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import {
  createIntentStateMachine,
  type IntentProposal,
  type IntentStateMachine,
  type IntentStep,
} from "../intents/state-machine.js";
import type { AgentStore } from "../ports.js";
import { agentStatusOf } from "./agent-status-of.js";
import type { FillProposal } from "./authorize-simulated.js";
import type { Proposer } from "./create-money-path.js";
import { proposalProblemCode } from "./proposal-problem-code.js";

/**
 * Stores a proposal the state machine passed as a new intent in `proposed`, under a fresh id, with
 * the info of each token it names that the registry does not list. An id in use is a fault: ids
 * never repeat.
 */
export async function storeProposed(
  options: { readonly stored: StoredIntents; readonly ids: IdSource },
  intent: {
    readonly request: IntentRequest;
    readonly proposer: Pick<Proposer, "ref">;
    readonly step: IntentStep;
    readonly wallet: Id<"wal">;
    readonly assets: AssetInfos;
  },
  signal: AbortSignal,
): Promise<IntentSnapshot> {
  const { request, proposer, step, wallet, assets } = intent;
  const id = options.ids.next("int");
  const unlisted = Object.keys(assets).length === 0 ? {} : { assets };
  const created = await options.stored.create(
    {
      id,
      agentId: request.agent,
      walletId: wallet,
      request,
      proposerRef: proposer.ref,
      step,
      ...unlisted,
    },
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
function proposalOf(
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

/** A proposal the state machine passed, with its agent's settings and the machine that moves it. */
export interface StartedProposal {
  readonly machine: IntentStateMachine;
  readonly settings: AgentSettings;
  readonly proposal: IntentProposal;
  readonly step: IntentStep;
}

/**
 * Reads the proposing agent's settings and checks the proposal with a new state machine, before
 * anything is resolved or stored: an unknown agent is `agent.not_found`, an archived one
 * `agent.archived`, and a proposer the kind does not take `auth.scope`.
 */
export async function startProposal(
  options: { readonly agents: AgentStore; readonly clock: Clock },
  call: {
    readonly request: IntentRequest;
    readonly proposer: Proposer;
    readonly fill?: FillProposal;
  },
  signal: AbortSignal,
): Promise<Result<StartedProposal, ProtocolErrorCode>> {
  const machine = createIntentStateMachine({ clock: options.clock });
  const settings = await options.agents.get(call.request.agent, { signal });
  const proposal = proposalOf(call, settings);
  const step = machine.propose(proposal);
  if (!step.ok || settings === undefined) {
    return err(step.ok ? "agent.not_found" : proposalProblemCode(step.error));
  }
  return ok({ machine, settings, proposal, step: step.value });
}
