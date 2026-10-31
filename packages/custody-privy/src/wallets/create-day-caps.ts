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

/**
 * A chain's caps with each token cap's token named by its place in the plan (decision 0305): a
 * ceiling holds its token caps in the order planned, a token that joined the plan later at the
 * end. Undefined when the ceiling holds more token caps than the plan names, so no cap is matched
 * to the wrong token.
 */
export function capsWithTokens(held: ChainCaps, plan: ChainCapPlan): ChainCaps | undefined {
  if (held.approvals.length > plan.approvals.length) {
    return undefined;
  }
  const approvals = held.approvals.map((cap, index) =>
    Object.assign({}, cap, { token: plan.approvals[index]?.token ?? "" }),
  );
  return { native: held.native, approvals };
}

/**
 * Makes the aggregation of each token cap the plan names past those a ceiling holds, owned by the
 * owner key's quorum, and answers the chain's caps with every token named, the new caps at the
 * end at their planned sizes. This is how a ceiling made before a token's cap joined the plan
 * gains it, in the change that first needs it (decision 0305). The ceiling's caps with the new
 * ones past Privy's 10 is `too_many_caps` before any is made; a ceiling holding more token caps
 * than the plan names, or a token that is no EVM address, is `malformed_address`.
 */
export async function addPlannedCaps(
  api: PrivyApi,
  request: { readonly held: ChainCaps; readonly plan: ChainCapPlan; readonly owner: PrivyId },
  options: CallOptions,
): Promise<Result<ChainCaps, "too_many_caps" | "malformed_address">> {
  const { plan, owner } = request;
  const held = capsWithTokens(request.held, plan);
  const listed = aggregationsOf(plan);
  if (held === undefined || !listed.ok) {
    return err("malformed_address");
  }
  const [, ...tokenDefinitions] = listed.value;
  const missing = tokenDefinitions.slice(held.approvals.length);
  if (1 + plan.approvals.length > maxAggregations) {
    return err("too_many_caps");
  }
  const approvals = [...held.approvals];
  for (const [index, definition] of missing.entries()) {
    const planned = plan.approvals[held.approvals.length + index];
    // oxlint-disable-next-line eslint/no-await-in-loop -- one write at a time: a fault stops the rest
    const aggregation = await api.createAggregation({ definition, owner }, options);
    approvals.push({
      aggregation,
      limitBase: planned?.limitBase ?? 0n,
      token: planned?.token ?? "",
    });
  }
  return ok({ native: held.native, approvals });
}
