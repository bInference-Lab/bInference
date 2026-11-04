import type { JsonValue } from "@binference/core";
import { z } from "zod";
import type { PrivyApi } from "../privy/privy-api.js";
import { isPrivyId, type PrivyId } from "../privy/privy-records.js";

/** What a run's policies name on Privy besides themselves: the caps they compare, their owners. */
export interface PolicyReferences {
  readonly aggregations: readonly PrivyId[];
  readonly quorums: readonly PrivyId[];
}

const rulesSchema = z.array(
  z.looseObject({
    conditions: z.array(z.looseObject({ field_source: z.string(), field: z.string() })),
  }),
);

// The aggregation ids a policy's rules compare, as `reference` conditions on `aggregation.<id>`.
function comparedBy(rules: readonly JsonValue[]): readonly PrivyId[] {
  const parsed = rulesSchema.safeParse(rules);
  const conditions = parsed.success ? parsed.data.flatMap((rule) => rule.conditions) : [];
  return conditions.flatMap((condition) => {
    const id = /^aggregation\.(.+)$/.exec(condition.field)?.[1] ?? "";
    return condition.field_source === "reference" && isPrivyId(id) ? [id] : [];
  });
}

/**
 * Reads each policy and answers the aggregations its rules compare and the key quorums that own
 * it, each once: what a sweep must remove for a run whose record names none of them, such as one
 * whose program made its ceiling itself. A policy Privy no longer holds names nothing.
 */
export async function policyReferences(
  api: PrivyApi,
  policies: readonly PrivyId[],
  signal: AbortSignal,
): Promise<PolicyReferences> {
  const aggregations = new Set<PrivyId>();
  const quorums = new Set<PrivyId>();
  for (const id of policies) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one request at a time, as every sweep call
    const read = await api.policy(id, { signal });
    if (read.ok) {
      comparedBy(read.value.rules).forEach((aggregation) => aggregations.add(aggregation));
      if (read.value.ownerId !== null) {
        quorums.add(read.value.ownerId);
      }
    }
  }
  return { aggregations: [...aggregations], quorums: [...quorums] };
}
