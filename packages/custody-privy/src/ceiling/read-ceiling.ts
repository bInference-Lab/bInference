import type { JsonValue } from "@binference/core";
import { z } from "zod";

/** A ceiling as Privy holds it now, read from its rules. Addresses are as the rules list them. */
export interface CeilingHeld {
  /** The EIP-155 id of each chain the ceiling names, in the order its rules name them. */
  readonly chainIds: readonly string[];
  /** The contracts a call may reach, each once. */
  readonly contracts: readonly string[];
  /**
   * The most native coin, in base units, one contract call may send on the first chain that
   * allows calls; 0 when no chain does.
   */
  readonly perTxNativeCapBase: bigint;
  /** Every address a native send may pay, each once. */
  readonly recipients: readonly string[];
}

// The fields of a rule this reads; Privy's ids and anything it adds later are left out.
const ruleSchema = z.object({
  name: z.string(),
  conditions: z.array(
    z.object({
      field: z.string(),
      operator: z.string(),
      value: z.union([z.string(), z.array(z.string())]),
    }),
  ),
});

type Rule = z.infer<typeof ruleSchema>;

const onChain = /, chain (\d{1,10})$/;
const quantity = /^0x[0-9a-fA-F]{1,64}$/;

function valuesOf(rule: Rule, field: string, operator: string): readonly string[] {
  const found = rule.conditions.find((item) => item.field === field && item.operator === operator);
  if (found === undefined) {
    return [];
  }
  return typeof found.value === "string" ? [found.value] : found.value;
}

function capOf(calls: readonly Rule[]): bigint | undefined {
  const [first] = calls;
  if (first === undefined) {
    return 0n;
  }
  const [cap = ""] = valuesOf(first, "value", "lte");
  return quantity.test(cap) ? BigInt(cap) : undefined;
}

/**
 * Reads a ceiling `buildCeiling` built back from the rules Privy holds: the chains its rules name,
 * the contracts its contract-call rules let a call reach and the cap of the first, and the
 * addresses its native send rules let a send pay. Rules this does not know count only for their
 * chain. A rule it cannot read, or a cap that is no quantity, makes the answer `undefined`.
 */
export function readCeiling(rules: readonly JsonValue[]): CeilingHeld | undefined {
  const parsed = rules.map((rule) => ruleSchema.safeParse(rule));
  const read = parsed.flatMap((item) => (item.success ? [item.data] : []));
  if (read.length !== rules.length) {
    return undefined;
  }
  const calls = read.filter((rule) => rule.name.startsWith("Contract calls, chain "));
  const sends = read.filter((rule) => rule.name.startsWith("Native sends, chain "));
  const perTxNativeCapBase = capOf(calls);
  if (perTxNativeCapBase === undefined) {
    return undefined;
  }
  const chainIds = read.flatMap((rule) => onChain.exec(rule.name)?.slice(1, 2) ?? []);
  return {
    chainIds: [...new Set(chainIds)],
    contracts: [...new Set(calls.flatMap((rule) => valuesOf(rule, "to", "in")))],
    perTxNativeCapBase,
    recipients: [...new Set(sends.flatMap((rule) => valuesOf(rule, "to", "in")))],
  };
}
