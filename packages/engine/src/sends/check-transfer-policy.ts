import type {
  AccountRef,
  Amount,
  AssetRef,
  ChainRegistry,
  RegisteredChain,
} from "@binference/chain";
import type { Clock } from "@binference/core";
import type { AgentSettings } from "../agents/agent-record.js";
import type { IntentStatus } from "../intents/intent-status.js";
import { policyFactsOf } from "../money-path/policy-facts-of.js";
import type { WalletFacts } from "../money-path/wallet-facts.js";
import type { PolicyCheck, PolicyVerdict } from "../policy/check-policy.js";

/** What the policy step of a send or a revoke runs on. */
export interface TransferPolicyParts {
  readonly policy: PolicyCheck;
  readonly chains: ChainRegistry;
  readonly clock: Clock;
}

/** A send or a revoke as the policy judges it, with the facts of its wallet now. */
export interface JudgedTransfer {
  readonly status: Pick<IntentStatus, "kind" | "isPaper" | "hasOutsideContent">;
  readonly settings: AgentSettings;
  readonly facts: WalletFacts;
  readonly chain: RegisteredChain;
  readonly nativeAsset: AssetRef;
  /** The install's rescue address in effect, which a send may pay. */
  readonly rescueAccount?: AccountRef;
  /** What a send moves out of the wallet; a revoke moves nothing. */
  readonly outflow?: Amount;
  /** Where a send pays; absent for a revoke, and for a paper send whose name was left unread. */
  readonly target?: AccountRef;
  /** The venue a bridge's route would take, judged against the agent's venues. */
  readonly venue?: string;
}

/**
 * The policy step of a send, a bridge or an approval revoke (spec 6, section 4): a send's or a
 * bridge's amount counts against the per-trade and 24-hour caps and the gas reserve as any outflow
 * does, its target must be the rescue address in effect or a saved address on its chain under the
 * send level, a bridge's venue one the agent may use, and all are refused in paper mode. A revoke
 * moves nothing, so no cap counts it. The same check runs when the proposal is resolved and again
 * as the wallet queue takes the intent.
 */
export async function checkTransferPolicy(
  parts: TransferPolicyParts,
  judged: JudgedTransfer,
  signal: AbortSignal,
): Promise<PolicyVerdict> {
  const { status, settings, facts, chain, nativeAsset, rescueAccount, outflow, target, venue } =
    judged;
  const policyFacts = policyFactsOf({
    settings,
    wallet: facts,
    chain: chain.ref,
    chains: parts.chains,
    nativeAsset,
    nowMs: parts.clock.now(),
  });
  const subject = {
    ...status,
    outflows: outflow === undefined ? [] : [outflow],
    inflowAssets: [],
    ...(target === undefined ? {} : { target }),
    ...(venue === undefined ? {} : { venue }),
  };
  const withRescue = rescueAccount === undefined ? policyFacts : { ...policyFacts, rescueAccount };
  return parts.policy.check(subject, withRescue, { signal });
}
