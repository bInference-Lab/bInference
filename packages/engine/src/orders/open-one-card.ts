import type { ChainRegistry, Signer } from "@binference/chain";
import {
  BinferenceError,
  type BinferenceErrorOptions,
  type Clock,
  err,
  type Id,
  type IdSource,
  type JsonValue,
  type Result,
} from "@binference/core";
import type { AssetInfos } from "@binference/protocol";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { NewIntent } from "../intents/intent-draft-of.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
import type { Proposer } from "../money-path/create-money-path.js";
import type { LaunchRouting } from "../money-path/launch-routing.js";
import { openCardUnchecked } from "../money-path/open-card-unchecked.js";
import type { ReadTokenFacts } from "../money-path/token-facts.js";
import type { AgentStore, IntentStore, WalletFactsSource } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import type { InstallQuotas } from "../quotas/install-quotas.js";
import type { InstallAccountParts } from "./install-accounts.js";

/**
 * What a use case that stores a record with one card reads and writes through, an auto order's
 * (decision 0189) or a webhook rule's (decision 0299), and where its pushes go.
 */
export interface OneCardParts {
  readonly stored: StoredIntents;
  readonly agents: AgentStore;
  /** Which wallets each agent owns, its default first. */
  readonly wallets: Pick<WalletFactsSource, "wallets">;
  /** Custody, which holds each wallet's account on each chain. */
  readonly custody: Pick<Signer, "account">;
  /** The install's wallets of every agent, which a record that names one is checked against. */
  readonly install: InstallAccountParts["install"];
  readonly chains: ChainRegistry;
  /** What intents stored of tokens the registry does not list, which record lists show. */
  readonly intents: Pick<IntentStore, "storedAssets">;
  /** Reads what a token the registry does not list answers on chain, for the record's card. */
  readonly readTokenFacts: ReadTokenFacts;
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly publish: PublishPush;
  /** Whether the engine is locked: the auto test reads it, and the card asks either way. */
  readonly isLocked: () => boolean;
  /** The card timer: closes an intent's card as expired once its time is up. */
  readonly expireCard: (intent: Id<"int">, call: { readonly signal: AbortSignal }) => Promise<void>;
  /** What sends a record on a launch's token to the agent's launch wallet (decision 0217). */
  readonly launches?: LaunchRouting;
  /**
   * The install's quotas, which a record's proposal and its store write count (decision 0431);
   * none when absent.
   */
  readonly quotas?: InstallQuotas;
}

/** What a record's one card opens from. */
export interface OneCardOpening {
  /** The stored record the card starts: its intent, agent, wallet, mode and outside mark. */
  readonly record: {
    readonly intentId: Id<"int">;
    readonly agentId: Id<"agt">;
    readonly walletId: Id<"wal">;
    readonly isPaper: boolean;
    readonly hasOutsideContent: boolean;
  };
  /** What the intent asks: the order's or the rule's card. */
  readonly request: Extract<NewIntent["request"], { readonly kind: "autoOrder" | "webhookRule" }>;
  readonly proposer: Proposer;
  readonly assets: AssetInfos;
  /** The card's quote at the time given: the record's terms, which the card's terms hash binds. */
  readonly quoteAt: (quotedAtMs: number) => JsonValue;
  /** The fault thrown when the intent cannot be stored. */
  readonly notStored: BinferenceErrorOptions;
}

/**
 * Stores a record's card-only intent and takes it to its one card, which never passes the auto
 * test. A refused step or a taken intent id is the opening's `notStored` fault.
 */
export async function openOneCard(
  parts: Pick<OneCardParts, "stored" | "clock" | "isLocked">,
  opening: OneCardOpening,
  signal: AbortSignal,
): Promise<IntentSnapshot> {
  const { record, request, proposer, assets } = opening;
  const machine = createIntentStateMachine({ clock: parts.clock });
  const step = machine.propose({
    kind: request.kind,
    proposer: proposer.role,
    isPaper: record.isPaper,
    hasOutsideContent: record.hasOutsideContent,
    agentStatus: "active",
  });
  const intent = {
    id: record.intentId,
    agentId: record.agentId,
    walletId: record.walletId,
    proposerRef: proposer.ref,
    request,
    ...(Object.keys(assets).length === 0 ? {} : { assets }),
  };
  const created = step.ok
    ? await parts.stored.create({ ...intent, step: step.value }, { signal })
    : undefined;
  if (created?.ok !== true) {
    throw new BinferenceError(opening.notStored);
  }
  const quotedAtMs = parts.clock.now();
  const advance = { stored: parts.stored, machine, signal };
  const quote = opening.quoteAt(quotedAtMs);
  return openCardUnchecked(advance, {
    proposed: created.value,
    quote,
    quotedAtMs,
    isLocked: parts.isLocked(),
  });
}

const isRefusal = <Refusal extends string>(
  refusal: Refusal,
): refusal is Exclude<Refusal, "exists"> => refusal !== "exists";

/**
 * The record a store stored, or the refusal it answered; an id in use is the `taken` fault, since
 * a new record's id comes from the id source.
 */
export function storedUnlessTaken<Stored, Refusal extends string>(
  created: Result<Stored, Refusal>,
  taken: BinferenceErrorOptions,
): Result<Stored, Exclude<Refusal, "exists">> {
  if (created.ok) {
    return created;
  }
  if (isRefusal(created.error)) {
    return err(created.error);
  }
  throw new BinferenceError(taken);
}
