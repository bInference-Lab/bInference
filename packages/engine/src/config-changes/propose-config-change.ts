import {
  BinferenceError,
  type Clock,
  err,
  type Id,
  type IdSource,
  ok,
  type Result,
} from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { AgentRecord } from "../agents/agent-record.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
import type { Proposer } from "../money-path/create-money-path.js";
import { openCardUnchecked } from "../money-path/open-card-unchecked.js";
import type { AgentStore, WalletFactsSource } from "../ports.js";
import type { ProposalQuotaParts } from "../quotas/install-quotas.js";
import type { ConfigChanges, ConfigPatchAsked } from "./config-change-parts.js";
import {
  type ConfigChangeRequest,
  configChangeLimits,
  configChangeQuoteDocument,
} from "./config-change-quote.js";

/** What a config change is previewed and stored through. */
export interface ConfigChangeProposalParts extends ProposalQuotaParts {
  readonly stored: StoredIntents;
  readonly agents: AgentStore;
  /** The agent's wallets, its default first, as the money path reads them. */
  readonly wallets: Pick<WalletFactsSource, "wallets">;
  readonly configChanges: ConfigChanges;
  /** Whether the engine is locked: a config change's card asks either way. */
  readonly isLocked: () => boolean;
  readonly clock: Clock;
  readonly ids: IdSource;
}

/** One proposal: the patch with its reason, the agent named, and who proposes it. */
interface ConfigChangeCall {
  readonly request: ConfigChangeRequest;
  /** The hash the patch was made from and the lists it may shorten. */
  readonly asked?: Omit<ConfigPatchAsked, "patch">;
  readonly agent?: Id<"agt">;
  readonly proposer: Proposer;
  readonly signal: AbortSignal;
}

const isActive = (agent: AgentRecord): boolean => agent.archivedAtMs === undefined;

// The agent named, or the install's only active agent, with its default wallet, which the intent
// is stored under: an install-wide setting still belongs to one agent's line of cards.
async function ownerOf(
  parts: ConfigChangeProposalParts,
  agent: Id<"agt"> | undefined,
  signal: AbortSignal,
): Promise<
  Result<{ readonly agentId: Id<"agt">; readonly walletId: Id<"wal"> }, ProtocolErrorCode>
> {
  const records = await parts.agents.list({ signal });
  const active = records.filter(isActive);
  const named = agent === undefined ? active : records.filter(({ id }) => id === agent);
  const [found] = named;
  if (found === undefined) {
    return err("agent.not_found");
  }
  if (!isActive(found)) {
    return err("agent.archived");
  }
  if (named.length > 1) {
    return err("protocol.bad_args");
  }
  const [walletId] = await parts.wallets.wallets(found.id, { signal });
  return walletId === undefined ? err("agent.not_found") : ok({ agentId: found.id, walletId });
}

async function create(
  parts: ConfigChangeProposalParts,
  call: ConfigChangeCall,
  owner: { readonly agentId: Id<"agt">; readonly walletId: Id<"wal"> },
): Promise<IntentSnapshot> {
  const { proposer, request, signal } = call;
  const step = createIntentStateMachine(parts).propose({
    kind: "configChange",
    proposer: proposer.role,
    isPaper: false,
    hasOutsideContent: proposer.hasOutsideContent,
    agentStatus: "active",
  });
  const intent = { id: parts.ids.next("int"), ...owner, proposerRef: proposer.ref };
  const created = step.ok
    ? await parts.stored.create({ ...intent, request, step: step.value }, { signal })
    : undefined;
  if (created?.ok !== true) {
    throw new BinferenceError({
      code: "engine.config_change_not_stored",
      message: "A new config change intent could not be stored.",
    });
  }
  return created.value;
}

/**
 * Stores a config change (decision 0393) and takes it to its card, which waits for the owner's
 * tap and never passes the auto test. Its quote names each key the JSON merge patch changes, with
 * the value the engine runs with before and after, and whether a restart applies it; the card
 * warns when the agent proposed it after reading outside content. A patch the config refuses is
 * `config.invalid`, one carrying a secret's value `config.secret_inline`, and one that changes
 * nothing, or more than 20 keys, `protocol.bad_args`, each before anything is stored. The intent
 * is stored live under the agent named, or the install's only active agent, and its default
 * wallet.
 */
export async function proposeConfigChange(
  parts: ConfigChangeProposalParts,
  call: ConfigChangeCall,
): Promise<Result<IntentSnapshot, ProtocolErrorCode>> {
  const { signal } = call;
  const owner = await ownerOf(parts, call.agent, signal);
  if (!owner.ok) {
    return owner;
  }
  await parts.quotas?.proposing({ agent: owner.value.agentId, kind: "configChange" }, { signal });
  const asked = { ...call.asked, patch: call.request.patch };
  const preview = await parts.configChanges.preview(asked, { signal });
  if (!preview.ok) {
    return preview;
  }
  const { changes, restartNeeded } = preview.value;
  if (changes.length === 0 || changes.length > configChangeLimits.keys) {
    return err("protocol.bad_args");
  }
  const quotedAtMs = parts.clock.now();
  const quote = configChangeQuoteDocument.encode({ changes, restartNeeded, quotedAtMs });
  const proposed = await create(parts, call, owner.value);
  const advance = { stored: parts.stored, machine: createIntentStateMachine(parts), signal };
  const run = { proposed, quote, quotedAtMs, isLocked: parts.isLocked() };
  return ok(await openCardUnchecked(advance, run));
}
