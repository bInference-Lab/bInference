import {
  type AccountRef,
  accountRefParts,
  type ChainRegistry,
  type NameResolution,
  type NameResolver,
  type RegisteredChain,
} from "@binference/chain";
import { type Clock, err, ok, type Result } from "@binference/core";
import type { ProtocolErrorCode, SendTarget } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import type { NameFailure } from "../intents/intent-reason.js";
import type { SentName } from "../intents/send-quote.js";
import { readName } from "../names/read-name.js";
import { canonicalAccount } from "../operations/canonical-account.js";

/**
 * Where a send pays, as its resolve step found it: an account in its family's canonical form, with
 * the name it was resolved from; a name that points to no person, which ends the send at that
 * step; or a name left unread, as for a paper send, which the policy refuses before anything
 * reads the chain.
 */
export type ResolvedTarget =
  | { readonly kind: "account"; readonly account: AccountRef; readonly name?: SentName }
  | { readonly kind: "refused"; readonly reason: NameFailure }
  | { readonly kind: "unread" };

/** What a send's target is resolved with. */
export interface TargetParts {
  readonly chains: ChainRegistry;
  /** The resolver of each name suffix; a name no resolver serves is `protocol.bad_args`. */
  readonly nameResolvers: readonly NameResolver[];
  readonly clock: Clock;
}

/** What one target is resolved for: the agent's address book, the chain, and the mode. */
interface Targeting {
  readonly settings: AgentSettings;
  readonly chain: RegisteredChain;
  readonly isPaper: boolean;
  readonly signal: AbortSignal;
}

// An account the request names must be on the wallet's chain, in its family's canonical form.
function accountOn(
  chains: ChainRegistry,
  account: AccountRef,
  chain: RegisteredChain,
): Result<AccountRef, ProtocolErrorCode> {
  const canonical = canonicalAccount(chains, account);
  return canonical.ok && accountRefParts(canonical.value).chain !== chain.ref
    ? err("protocol.bad_args")
    : canonical;
}

// The reverse record's other name is set by whoever controls the address: kept short.
const reverseLength = 255;

function sentNameOf(answer: Extract<NameResolution, { kind: "found" }>, atMs: number): SentName {
  const { name, smartAccount, reverse } = answer;
  const other =
    reverse?.kind === "differs" ? Array.from(reverse.other).slice(0, reverseLength).join("") : "";
  return {
    name,
    resolvedAtMs: atMs,
    ...(smartAccount === undefined ? {} : { smartAccount }),
    ...(other === "" ? {} : { reverseOther: other }),
  };
}

// A found name pays its address, read on the wallet's chain; no address, or a contract's, ends it.
function nameTarget(
  parts: TargetParts,
  answer: NameResolution,
  chain: RegisteredChain,
): Result<ResolvedTarget, ProtocolErrorCode> {
  if (answer.kind === "malformed") {
    return err("protocol.bad_args");
  }
  if (answer.kind !== "found") {
    const reason = answer.kind === "contract" ? "name_contract" : "name_unresolved";
    return ok({ kind: "refused", reason });
  }
  // A name of another chain's naming service never pays on this one.
  const account = accountOn(parts.chains, answer.address, chain);
  return account.ok
    ? ok({ kind: "account", account: account.value, name: sentNameOf(answer, parts.clock.now()) })
    : account;
}

/**
 * Resolves where a send pays (protocol spec, section 8.1): an address on the wallet's chain, an
 * address book entry on it, or a `.bnb` name, read through its resolver now (decision 0308). An
 * address, an entry or a name's address on another chain, or a name no resolver serves or that
 * does not normalize, is `protocol.bad_args`; an entry not in the agent's book `address.not_found`; a resolver that
 * does not answer `name.resolver_down`. A paper send's name is left unread: the policy refuses
 * every paper send first. None of them stores anything.
 */
export async function resolveTarget(
  parts: TargetParts,
  to: SendTarget,
  targeting: Targeting,
): Promise<Result<ResolvedTarget, ProtocolErrorCode>> {
  const { settings, chain, isPaper, signal } = targeting;
  if ("address" in to) {
    const account = accountOn(parts.chains, to.address, chain);
    return account.ok ? ok({ kind: "account", account: account.value }) : account;
  }
  if ("entry" in to) {
    const entry = settings.addressBook.find(({ id }) => id === to.entry);
    if (entry === undefined) {
      return err("address.not_found");
    }
    const account = accountOn(parts.chains, entry.account, chain);
    return account.ok ? ok({ kind: "account", account: account.value }) : account;
  }
  if (isPaper) {
    return ok({ kind: "unread" });
  }
  const answer = await readName(parts.nameResolvers, to.name, signal);
  return answer.ok ? nameTarget(parts, answer.value, chain) : answer;
}
