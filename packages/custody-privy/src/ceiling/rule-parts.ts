import type { DayCap } from "./ceiling.js";
import type {
  CalldataCondition,
  PolicyCondition,
  PolicyRule,
  ReferenceCondition,
  TransactionCondition,
} from "./policy-rule.js";

/** No native coin, as a rule's `value lte` writes it. */
export const noValue = "0x0";

/** The variable Privy puts the address of the signing wallet in place of. */
export const walletAddress = "{{wallet.address}}";

/** A number as the hex quantity Privy's conditions compare. */
export function hexOf(value: bigint): string {
  return `0x${value.toString(16)}`;
}

/** A condition on the transaction's `to`, `value` or chain id. */
export function onTransaction(
  field: TransactionCondition["field"],
  operator: TransactionCondition["operator"],
  value: TransactionCondition["value"],
): TransactionCondition {
  return { field_source: "ethereum_transaction", field, operator, value };
}

/**
 * A condition on one calldata field decoded with the function's ABI: `eq` for one value, `in` for
 * a list.
 */
export function onCalldata(
  abi: CalldataCondition["abi"][number],
  field: string,
  value: CalldataCondition["value"],
): CalldataCondition {
  return {
    field_source: "ethereum_calldata",
    field,
    abi: [abi],
    operator: typeof value === "string" ? "eq" : "in",
    value,
  };
}

/** A condition that holds while a 24-hour cap's sum, the request included, is at most its limit. */
export function onCap(cap: DayCap): ReferenceCondition {
  const field = `aggregation.${cap.aggregation}`;
  return { field_source: "reference", field, operator: "lte", value: hexOf(cap.limitBase) };
}

/** A rule that allows `eth_signTransaction` when every condition holds. */
export function allow(name: string, conditions: readonly PolicyCondition[]): PolicyRule {
  return { name, method: "eth_signTransaction", action: "ALLOW", conditions };
}
