import { z } from "zod";

// The request bodies Privy's OpenAPI document describes for the calls binference makes, as
// strict as Privy is: an unknown key is refused. Condition kinds binference never writes
// (typed data, Solana, system time) are refused by the fake, never silently ignored.

/** The operators of Privy's conditions. */
type FakeOperator = "eq" | "gt" | "gte" | "lt" | "lte" | "in" | "in_condition_set";

/** A function of a condition's ABI, with named, typed inputs. */
export interface FakeAbiFunction {
  readonly type: "function";
  readonly name: string;
  readonly inputs: readonly { readonly name: string; readonly type: string }[];
  readonly outputs: readonly { readonly name: string; readonly type: string }[];
  readonly stateMutability: "pure" | "view" | "nonpayable" | "payable";
}

/** A condition, either on the transaction or on its decoded calldata. */
export interface FakeCondition {
  readonly field_source: "ethereum_transaction" | "ethereum_calldata";
  readonly field: string;
  readonly abi?: readonly FakeAbiFunction[];
  readonly operator: FakeOperator;
  readonly value: string | readonly string[];
}

/** A rule as the fake stores it. */
export interface FakeRule {
  readonly name: string;
  readonly method: string;
  readonly action: "ALLOW" | "DENY";
  readonly conditions: readonly FakeCondition[];
}

/** A policy create body. */
export interface FakePolicyBody {
  readonly name: string;
  readonly rules: readonly FakeRule[];
  readonly owner_id?: string | null | undefined;
}

/** A key quorum create body, with public keys only. */
export interface FakeKeyQuorumBody {
  readonly public_keys: readonly string[];
  readonly authorization_threshold?: number | undefined;
  readonly display_name?: string | undefined;
}

/** A wallet create body. */
export interface FakeWalletBody {
  readonly owner_id?: string | null | undefined;
  readonly policy_ids?: readonly string[] | undefined;
  readonly additional_signers?:
    | readonly {
        readonly signer_id: string;
        readonly override_policy_ids?: readonly string[] | undefined;
      }[]
    | undefined;
  readonly display_name?: string | undefined;
}

/** Hex text, `0x` and digits. */
type FakeHex = `0x${string}`;

/** A quantity as Privy takes it: hex text or a safe integer. */
export type FakeQuantity = FakeHex | number;

/** The fields of an `eth_signTransaction` transaction the fake signs: a full type 2 call. */
export interface FakeTransaction {
  readonly to: FakeHex;
  readonly chain_id: FakeQuantity;
  readonly nonce: FakeQuantity;
  readonly gas_limit: FakeQuantity;
  readonly max_fee_per_gas: FakeQuantity;
  readonly max_priority_fee_per_gas: FakeQuantity;
  readonly value?: FakeQuantity | undefined;
  readonly data?: FakeHex | undefined;
  readonly type?: 2 | undefined;
  readonly from?: string | undefined;
}

const methods = [
  "eth_sendTransaction",
  "eth_signTransaction",
  "eth_signUserOperation",
  "eth_signTypedData_v4",
  "personal_sign",
  "eth_sign7702Authorization",
  "wallet_sendCalls",
  "exportPrivateKey",
  "*",
] as const;

const operators = ["eq", "gt", "gte", "lt", "lte", "in", "in_condition_set"] as const;
function hexOf(pattern: RegExp): z.ZodType<FakeHex, string> {
  return z.string().refine((text): text is FakeHex => pattern.test(text));
}

const quantity = z.union([hexOf(/^0x[0-9a-fA-F]+$/), z.int().nonnegative()]);
const parameter = z.object({ name: z.string(), type: z.string().min(1) });

const abiFunction = z.object({
  type: z.literal("function"),
  name: z.string().min(1),
  inputs: z.array(parameter).default([]),
  outputs: z.array(parameter).default([]),
  stateMutability: z.enum(["pure", "view", "nonpayable", "payable"]).default("nonpayable"),
});

// `in` takes from 1 to 100 values; every other operator takes one.
const valueFits = (condition: { readonly operator: string; readonly value: unknown }): boolean =>
  condition.operator === "in"
    ? Array.isArray(condition.value) && condition.value.length > 0 && condition.value.length <= 100
    : typeof condition.value === "string";

const conditionSchema: z.ZodType<FakeCondition> = z
  .discriminatedUnion("field_source", [
    z.strictObject({
      field_source: z.literal("ethereum_transaction"),
      field: z.enum(["to", "value", "chain_id"]),
      operator: z.enum(operators),
      value: z.union([z.string(), z.array(z.string())]),
    }),
    z.strictObject({
      field_source: z.literal("ethereum_calldata"),
      field: z.string().min(1),
      abi: z.array(abiFunction).min(1).max(200),
      operator: z.enum(operators),
      value: z.union([z.string(), z.array(z.string())]),
    }),
  ])
  .refine(valueFits);

const ruleSchema: z.ZodType<FakeRule> = z
  .strictObject({
    name: z.string().min(1).max(50),
    method: z.enum(methods),
    conditions: z.array(conditionSchema),
    action: z.enum(["ALLOW", "DENY"]),
  })
  .refine((rule) => rule.method !== "exportPrivateKey" || rule.conditions.length === 0);

/** Parses a policy create body for Ethereum. */
export const fakePolicyBodySchema: z.ZodType<FakePolicyBody> = z.strictObject({
  version: z.literal("1.0"),
  name: z.string().min(1).max(50),
  chain_type: z.literal("ethereum"),
  rules: z.array(ruleSchema),
  owner_id: z.string().nullish(),
});

/** Parses a key quorum create body. */
export const fakeKeyQuorumBodySchema: z.ZodType<FakeKeyQuorumBody> = z.strictObject({
  public_keys: z.array(z.string().min(1)).min(1),
  authorization_threshold: z.int().min(1).optional(),
  display_name: z.string().max(50).optional(),
});

/** Parses a wallet create body for Ethereum. */
export const fakeWalletBodySchema: z.ZodType<FakeWalletBody> = z.strictObject({
  chain_type: z.literal("ethereum"),
  owner_id: z.string().nullish(),
  policy_ids: z.array(z.string()).max(1).optional(),
  additional_signers: z
    .array(
      z.strictObject({
        signer_id: z.string(),
        override_policy_ids: z.array(z.string()).max(1).optional(),
      }),
    )
    .optional(),
  display_name: z.string().max(100).optional(),
});

/** Parses an `eth_signTransaction` body and keeps its transaction. */
export const fakeSignBodySchema: z.ZodType<FakeTransaction> = z
  .strictObject({
    method: z.literal("eth_signTransaction"),
    chain_type: z.literal("ethereum").optional(),
    address: z.string().optional(),
    wallet_id: z.string().optional(),
    params: z.strictObject({
      transaction: z.strictObject({
        to: hexOf(/^0x[0-9a-fA-F]{40}$/),
        chain_id: quantity,
        nonce: quantity,
        gas_limit: quantity,
        max_fee_per_gas: quantity,
        max_priority_fee_per_gas: quantity,
        value: quantity.optional(),
        data: hexOf(/^0x(?:[0-9a-fA-F]{2})*$/).optional(),
        type: z.literal(2).optional(),
        from: z.string().optional(),
      }),
    }),
  })
  .transform((body) => body.params.transaction);

/** Parses JSON text; text that is no JSON is undefined. */
export function parseJsonText(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}
