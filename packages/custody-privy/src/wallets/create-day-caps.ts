import { err, ok, type Result } from "@binference/core";
import { type ChainCaps, maxAggregations } from "../ceiling/ceiling.js";
import {
  type AggregationDefinition,
  aggregationsOf,
  type ChainCapPlan,
  capsOf,
} from "../ceiling/day-caps.js";
import type { CallOptions, PrivyApi } from "../privy/privy-api.js";
import type { PrivyId } from "../privy/privy-records.js";

/**
 * Makes the aggregations each chain's 24-hour caps read (decision 0149), one at a time, owned by
 * the owner key's quorum, and answers each chain's caps in the order planned. Privy sums each
 * aggregation over every wallet of the app whose policy names it, so an install makes them once
 * and every ceiling it builds names the same ones. More than Privy's 10 is `too_many_caps`
 * before any is made, and a token that is no EVM address is `malformed_address`.
 */
export async function createDayCaps(
  api: PrivyApi,
  request: { readonly plans: readonly ChainCapPlan[]; readonly owner: PrivyId },
  options: CallOptions,
): Promise<Result<readonly ChainCaps[], "too_many_caps" | "malformed_address">> {
  const definitions: (readonly AggregationDefinition[])[] = [];
  for (const plan of request.plans) {
    const listed = aggregationsOf(plan);
    if (!listed.ok) {
      return listed;
    }
    definitions.push(listed.value);
  }
  if (definitions.flat().length > maxAggregations) {
    return err("too_many_caps");
  }
  const caps: ChainCaps[] = [];
  for (const [index, plan] of request.plans.entries()) {
    const ids: string[] = [];
    for (const definition of definitions[index] ?? []) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one write at a time: a fault stops the rest
      ids.push(await api.createAggregation({ definition, owner: request.owner }, options));
    }
    const made = capsOf(plan, ids);
    if (made !== undefined) {
      caps.push(made);
    }
  }
  return ok(caps);
}
