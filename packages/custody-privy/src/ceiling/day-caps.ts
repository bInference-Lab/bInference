import type { EvmChain } from "@binference/chain-evm";
import { err, ok, type Result } from "@binference/core";
import { addressList } from "./build-ceiling.js";
import { approveAbi } from "./ceiling-abis.js";
import type { ChainCaps } from "./ceiling.js";
import type { AbiFunction, TransactionCondition } from "./policy-rule.js";

/** One capped token and the most its approvals may name in 24 hours, in base units. */
export interface TokenCapPlan {
  /** The token contract, an EVM address in any case. */
  readonly token: string;
  readonly limitBase: bigint;
}

/** What one chain's 24-hour caps allow, before Privy holds the aggregations that sum them. */
export interface ChainCapPlan {
  readonly chain: EvmChain;
  /** The most native coin the wallets may send in 24 hours, in base units. */
  readonly nativeLimitBase: bigint;
  readonly approvals: readonly TokenCapPlan[];
}

/**
 * A rolling sum Privy is asked to keep (`POST /v1/aggregations`): what it sums over every
 * `eth_signTransaction` of the app's wallets whose policy names it, and which of those count.
 */
export interface AggregationDefinition {
  /** A label for Privy's dashboard, at most 255 characters. */
  readonly name: string;
  /** The field summed: `value`, or an argument read from calldata with `abi`. */
  readonly metric: {
    readonly field: string;
    readonly fieldSource: "ethereum_transaction" | "ethereum_calldata";
    readonly abi?: AbiFunction;
  };
  readonly windowSeconds: number;
  /** Every condition must hold for a request to count. */
  readonly conditions: readonly TransactionCondition[];
}

/** The 24-hour window of every cap, in seconds; Privy takes 1 to 72 hours. */
export const dayCapWindowSeconds = 86_400;

function onChain(chain: EvmChain): TransactionCondition {
  const value = String(chain.chainId);
  return { field_source: "ethereum_transaction", field: "chain_id", operator: "eq", value };
}

/**
 * The aggregations one chain's caps need, the native coin's first, then each token's in the
 * order planned: the native value of every transaction on the chain, and the amount of every
 * `approve` call to each capped token. A token that is no EVM address is refused.
 */
export function aggregationsOf(
  plan: ChainCapPlan,
): Result<readonly AggregationDefinition[], "malformed_address"> {
  const tokens = addressList(plan.approvals.map((item) => item.token));
  if (!tokens.ok || tokens.value.length !== plan.approvals.length) {
    return err("malformed_address");
  }
  const chainId = String(plan.chain.chainId);
  const native: AggregationDefinition = {
    name: `binference native sent, chain ${chainId}`,
    metric: { field: "value", fieldSource: "ethereum_transaction" },
    windowSeconds: dayCapWindowSeconds,
    conditions: [onChain(plan.chain)],
  };
  const approvals = tokens.value.map((token): AggregationDefinition => ({
    name: `binference approvals of ${token}, chain ${chainId}`,
    metric: { field: "approve.amount", fieldSource: "ethereum_calldata", abi: approveAbi },
    windowSeconds: dayCapWindowSeconds,
    conditions: [
      onChain(plan.chain),
      { field_source: "ethereum_transaction", field: "to", operator: "eq", value: token },
    ],
  }));
  return ok([native, ...approvals]);
}

/**
 * One chain's caps from its plan and the ids Privy gave its aggregations, in the order
 * {@link aggregationsOf} lists them. Ids of another count are `undefined`.
 */
export function capsOf(plan: ChainCapPlan, ids: readonly string[]): ChainCaps | undefined {
  const [native, ...approvals] = ids;
  if (native === undefined || approvals.length !== plan.approvals.length) {
    return undefined;
  }
  return {
    native: { aggregation: native, limitBase: plan.nativeLimitBase },
    approvals: plan.approvals.map((item, index) => ({
      aggregation: approvals[index] ?? "",
      limitBase: item.limitBase,
    })),
  };
}
