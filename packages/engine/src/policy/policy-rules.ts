import type { AccountRef, Amount, AssetRef } from "@binference/chain";
import type { Bps } from "@binference/core";
import type { IntentKind } from "../intents/intent-kind.js";
import type { PolicyRejection } from "../intents/intent-reason.js";
import type { IntentStatus } from "../intents/intent-status.js";

/** Where sends may go among the saved addresses: 0 Open, 1 Known, 2 Cooled book, 3 Locked. */
export type SendLevel = 0 | 1 | 2 | 3;

/** One entry of the agent's address book. The caller leaves removed entries out. */
export interface AddressBookEntry {
  /** The address on its chain, in the chain family's canonical form. */
  readonly account: AccountRef;
  /** Saved in the ceiling with the owner key (decision 0091), so a send may pay it. */
  readonly isSaved: boolean;
  /** Epoch milliseconds from which send level 2 lets a send pay it. */
  readonly usableAtMs: number;
}

/** One earlier outgoing trade or send of the agent, valued in USD when it was confirmed. */
export interface PastOutflow {
  readonly atMs: number;
  readonly valueUsdMicros: bigint;
}

/** The agent's limits as the policy reads them (spec 2, `defaults.limits`). */
export interface PolicyLimits {
  readonly perTradeCapUsdMicros: bigint;
  readonly rollingDayCapUsdMicros: bigint;
  /** The most slippage a request may ask: for a pair of registry tokens, and for any other pair. */
  readonly maxSlippageBps: { readonly registry: Bps; readonly other: Bps };
  readonly maxTaxBps: Bps;
  /** The native coin a wallet keeps for network fees on its chain, in base units. */
  readonly gasReserveBase: bigint;
  /** The venues the agent may use. */
  readonly venues: readonly string[];
  /** When not empty, the only tokens the agent may touch. */
  readonly allowTokens: readonly AssetRef[];
  readonly denyTokens: readonly AssetRef[];
}

/** The slippage a request asks for, and whether both tokens of its pair are in the registry. */
export interface RequestedSlippage {
  readonly bps: Bps;
  readonly isRegistryPair: boolean;
}

/**
 * A resolved intent as the policy reads it: the wallet, tokens and base units are known. Every
 * account and asset is in its chain family's canonical form.
 */
export interface PolicySubject extends Pick<
  IntentStatus,
  "kind" | "isPaper" | "hasOutsideContent"
> {
  /** What leaves the agent's wallet, in base units. The caps, the ceiling and the reserve count it. */
  readonly outflows: readonly Amount[];
  /** Every asset the intent moves into or out of the wallet. */
  readonly tokens: readonly AssetRef[];
  /** The venue the request names, or the one that quoted when the policy runs again. */
  readonly venue?: string;
  /** Absent when the request leaves slippage to the agent's maximum. */
  readonly slippage?: RequestedSlippage;
  /** Where a send, a bridge or a rescue pays. */
  readonly target?: AccountRef;
}

/** What the store knows about the agent and the intent's wallet when the policy runs. */
export interface PolicyFacts {
  /** The agent or the whole install is frozen. */
  readonly isFrozen: boolean;
  readonly limits: PolicyLimits;
  readonly sendLevel: SendLevel;
  readonly addressBook: readonly AddressBookEntry[];
  /** The rescue address on the target's chain; absent when the owner set none. */
  readonly rescueAccount?: AccountRef;
  /** The native coin of the wallet's chain. */
  readonly nativeAsset: AssetRef;
  /** The wallet's native balance in base units: the paper balance for a paper intent. */
  readonly nativeBalanceBase: bigint;
  /** The ceiling's native value cap per transaction, in base units (spec 5, section 4). */
  readonly ceilingPerTxNativeBase: bigint;
  /**
   * The highest tax known for the intent's tokens, from the risk cache or a decoded quote. Absent
   * when no source knows it yet; the risk step decodes it after the quote.
   */
  readonly knownTaxBps?: Bps;
  /**
   * The agent's outgoing trades and sends in the intent's mode (paper or live), each counted from
   * its confirmation at the USD value it was confirmed with, without the intent under check and
   * without those that ended unsent or reverted. The store builds this list from the intents and
   * the ledger; the policy only reads it, and keeps those of the last 24 hours.
   */
  readonly recentOutflows: readonly PastOutflow[];
}

/** The USD figures the caps were checked with. */
export interface PolicyFigures {
  /** What the intent's outflows are worth, each rounded up to a whole micro-dollar. */
  readonly valueUsdMicros: bigint;
  /** What the agent's outflows of the last 24 hours add up to, before this intent. */
  readonly rollingDaySpentUsdMicros: bigint;
}

/** What each rule reads. `figures` is absent when an outflow had no USD price. */
export interface PolicyInput {
  readonly subject: PolicySubject;
  readonly facts: PolicyFacts;
  readonly nowMs: number;
  readonly figures?: PolicyFigures;
}

interface PolicyRule {
  readonly reason: PolicyRejection;
  readonly refuses: (input: PolicyInput) => boolean;
}

// A send, a bridge, a CEX order and an identity act outside the paper portfolio; so does a rescue,
// which its own rules refuse in paper mode.
const liveOnlyKinds: ReadonlySet<IntentKind> = new Set<IntentKind>([
  "send",
  "bridge",
  "cexOrder",
  "registerIdentity",
]);

// A bridge is a cross-chain send (decision 0067): the send level and the address book apply.
const sendKinds: ReadonlySet<IntentKind> = new Set<IntentKind>(["send", "bridge"]);

function nativeOutBase({ subject, facts }: PolicyInput): bigint {
  return subject.outflows
    .filter((outflow) => outflow.asset === facts.nativeAsset)
    .reduce((sum, outflow) => sum + outflow.base, 0n);
}

function entryOf({ subject, facts }: PolicyInput): AddressBookEntry | undefined {
  return facts.addressBook.find((entry) => entry.account === subject.target);
}

function paysRescue({ subject, facts }: PolicyInput): boolean {
  return subject.target !== undefined && subject.target === facts.rescueAccount;
}

function isSend(input: PolicyInput): boolean {
  return sendKinds.has(input.subject.kind);
}

// Level 3 allows no send. Level 2 makes a saved address usable only once its cooling ends.
function breaksSendLevel(input: PolicyInput): boolean {
  if (input.facts.sendLevel === 3) {
    return true;
  }
  const entry = entryOf(input);
  return (
    input.facts.sendLevel === 2 &&
    !paysRescue(input) &&
    entry?.isSaved === true &&
    entry.usableAtMs > input.nowMs
  );
}

function paysUnsaved(input: PolicyInput): boolean {
  return !paysRescue(input) && entryOf(input)?.isSaved !== true;
}

// The rescue address is the owner's own, so only an address outside the book counts as unknown.
function paysUnknown(input: PolicyInput): boolean {
  return !paysRescue(input) && entryOf(input) === undefined;
}

// The native coin pays network fees on every chain, so the token lists never judge it.
function isTokenDenied({ subject, facts }: PolicyInput): boolean {
  const { allowTokens, denyTokens } = facts.limits;
  return subject.tokens.some(
    (token) =>
      token !== facts.nativeAsset &&
      (denyTokens.includes(token) || (allowTokens.length > 0 && !allowTokens.includes(token))),
  );
}

function asksTooMuchSlippage({ subject, facts }: PolicyInput): boolean {
  const { slippage } = subject;
  if (slippage === undefined) {
    return false;
  }
  const { registry, other } = facts.limits.maxSlippageBps;
  return slippage.bps > (slippage.isRegistryPair ? registry : other);
}

/**
 * The rules of spec 6, section 4, in its order. `price_impact` is checked after the quote, and
 * `health_factor` once a lending venue reads positions.
 */
const intentRules: readonly PolicyRule[] = [
  { reason: "frozen", refuses: ({ facts }) => facts.isFrozen },
  {
    reason: "paper_only",
    refuses: ({ subject }) => subject.isPaper && liveOnlyKinds.has(subject.kind),
  },
  {
    reason: "per_trade_cap",
    refuses: ({ facts, figures }) =>
      figures !== undefined && figures.valueUsdMicros > facts.limits.perTradeCapUsdMicros,
  },
  {
    // A send pays a saved address, which the ceiling bounds by its recipient, not its value.
    reason: "ceiling",
    refuses: (input) =>
      input.subject.kind !== "send" && nativeOutBase(input) > input.facts.ceilingPerTxNativeBase,
  },
  {
    reason: "daily_cap",
    refuses: ({ facts, figures }) =>
      figures !== undefined &&
      figures.rollingDaySpentUsdMicros + figures.valueUsdMicros >
        facts.limits.rollingDayCapUsdMicros,
  },
  {
    // Gas is paid from the reserve, so an intent that spends no native coin never breaks it.
    reason: "gas_reserve",
    refuses: (input) => {
      const spentBase = nativeOutBase(input);
      return (
        spentBase > 0n &&
        input.facts.nativeBalanceBase - spentBase < input.facts.limits.gasReserveBase
      );
    },
  },
  { reason: "slippage", refuses: asksTooMuchSlippage },
  {
    reason: "tax",
    refuses: ({ facts }) =>
      facts.knownTaxBps !== undefined && facts.knownTaxBps > facts.limits.maxTaxBps,
  },
  {
    reason: "venue_off",
    refuses: ({ subject, facts }) =>
      subject.venue !== undefined && !facts.limits.venues.includes(subject.venue),
  },
  { reason: "token_denied", refuses: isTokenDenied },
  { reason: "send_level", refuses: (input) => isSend(input) && breaksSendLevel(input) },
  { reason: "unsaved_address", refuses: (input) => isSend(input) && paysUnsaved(input) },
  {
    reason: "outside_content_send",
    refuses: (input) => isSend(input) && input.subject.hasOutsideContent && paysUnknown(input),
  },
  { reason: "no_price", refuses: ({ figures }) => figures === undefined },
];

// A rescue pays only the owner's rescue address, so it skips the freeze, the send level, the caps
// and the reserve (decisions 0044 and 0099).
const rescueRules: readonly PolicyRule[] = [
  { reason: "paper_only", refuses: ({ subject }) => subject.isPaper },
  { reason: "unsaved_address", refuses: (input) => !paysRescue(input) },
];

/**
 * Every rule the intent breaks, in the order of spec 6, section 4. An empty list means it passes.
 * A rescue reads neither prices nor figures.
 */
export function policyRefusals(input: PolicyInput): readonly PolicyRejection[] {
  const rules = input.subject.kind === "rescue" ? rescueRules : intentRules;
  return rules.filter((rule) => rule.refuses(input)).map((rule) => rule.reason);
}
