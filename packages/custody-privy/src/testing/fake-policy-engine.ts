import type { Hex } from "viem";
import { readCalldataField } from "./fake-calldata.schema.js";
import type { FakeCondition, FakeRule } from "./fake-privy-request.schema.js";

/** A transaction as the fake's policy engine reads it from an `eth_signTransaction` body. */
export interface PolicyInput {
  readonly method: string;
  /** `to` verbatim, in the case the request wrote it. */
  readonly to: string;
  readonly valueWei: bigint;
  readonly chainId: bigint;
  readonly data: Hex;
  /** The address of the wallet that signs, for `{{wallet.address}}`. */
  readonly walletAddress: string;
}

type Compared = string | bigint;

const walletVariable = "{{wallet.address}}";

const numeric: Readonly<
  Record<"gt" | "gte" | "lt" | "lte", (left: bigint, right: bigint) => boolean>
> = {
  gt: (left, right) => left > right,
  gte: (left, right) => left >= right,
  lt: (left, right) => left < right,
  lte: (left, right) => left <= right,
};

function asNumber(text: string): bigint | undefined {
  return /^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(text) ? BigInt(text) : undefined;
}

// Strings compare case by case, as Privy's do; numbers compare as numbers whatever their base.
function holds(left: Compared, condition: FakeCondition, input: PolicyInput): boolean {
  const values = [condition.value]
    .flat()
    .map((value) => (value === walletVariable ? input.walletAddress : value));
  const right = typeof left === "bigint" ? values.map(asNumber) : values;
  const [first] = right;
  if (condition.operator === "eq") {
    return first === left;
  }
  if (condition.operator === "in") {
    return right.some((item) => item === left);
  }
  if (condition.operator === "in_condition_set") {
    return false;
  }
  return (
    typeof left === "bigint" &&
    typeof first === "bigint" &&
    numeric[condition.operator](left, first)
  );
}

function transactionField(field: string, input: PolicyInput): Compared | undefined {
  switch (field) {
    case "to":
      return input.to;
    case "value":
      return input.valueWei;
    case "chain_id":
      return input.chainId;
    default:
      return undefined;
  }
}

function conditionHolds(condition: FakeCondition, input: PolicyInput): boolean {
  const left =
    condition.field_source === "ethereum_transaction"
      ? transactionField(condition.field, input)
      : readCalldataField(condition.abi ?? [], condition.field, input.data);
  return left !== undefined && holds(left, condition, input);
}

/**
 * Privy's policy semantics: only the rules of the request's method (or `*`) apply; a rule applies
 * when every condition holds; a `DENY` that applies wins; with no `ALLOW` that applies, the
 * request is denied.
 */
export function evaluatePolicy(rules: readonly FakeRule[], input: PolicyInput): "ALLOW" | "DENY" {
  const applying = rules.filter(
    (rule) =>
      (rule.method === input.method || rule.method === "*") &&
      rule.conditions.every((condition) => conditionHolds(condition, input)),
  );
  if (applying.some((rule) => rule.action === "DENY")) {
    return "DENY";
  }
  return applying.some((rule) => rule.action === "ALLOW") ? "ALLOW" : "DENY";
}
