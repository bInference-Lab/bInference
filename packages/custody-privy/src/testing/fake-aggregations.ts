import { type HttpResponse, type JsonValue, jsonValueSchema } from "@binference/core";
import { maxAggregations } from "../ceiling/ceiling.js";
import { readCalldataField } from "./fake-calldata.schema.js";
import { conditionsHold, type FakeReferences, type PolicyInput } from "./fake-policy-engine.js";
import { answer, failure } from "./fake-privy-answers.js";
import { fakeAggregationBodySchema } from "./fake-privy-request.schema.js";
import {
  type FakeAddition,
  type FakeAggregation,
  type FakePolicy,
  type FakePrivyState,
  newFakeId,
} from "./fake-privy-state.js";

function aggregationJson(aggregation: FakeAggregation): JsonValue {
  const { body } = aggregation;
  return {
    name: body.name,
    method: body.method,
    metric: jsonValueSchema.parse(body.metric),
    window: { type: body.window.type, seconds: body.window.seconds },
    conditions: jsonValueSchema.parse(body.conditions),
    group_by: [],
    id: aggregation.id,
    created_at: aggregation.createdAt,
    owner_id: aggregation.ownerId,
  };
}

/**
 * Answers `POST /v1/aggregations` as Privy's API reference describes it: a strict body, an owner
 * the app holds when named, and at most 10 aggregations for the app.
 */
export function createAggregation(state: FakePrivyState, body: JsonValue): HttpResponse {
  const parsed = fakeAggregationBodySchema.safeParse(body);
  const ownerId = parsed.data?.owner_id ?? null;
  if (!parsed.success || (ownerId !== null && !state.quorums.has(ownerId))) {
    return failure(400, "invalid_data", "The request body does not match the schema.");
  }
  if (state.aggregations.size >= maxAggregations) {
    return failure(400, "invalid_data", "An app holds at most 10 aggregations.");
  }
  const made = {
    id: newFakeId(state),
    body: parsed.data,
    ownerId,
    createdAt: state.clock.now(),
  };
  state.aggregations.set(made.id, made);
  return answer(200, aggregationJson(made));
}

/** Answers `GET` or `DELETE /v1/aggregations/<id>`; a deleted one is gone with its sums. */
export function answerAggregation(state: FakePrivyState, method: string, id: string): HttpResponse {
  const held = state.aggregations.get(id);
  if (held === undefined) {
    return failure(404, "not_found", "Not found.");
  }
  if (method === "DELETE") {
    state.aggregations.delete(id);
    state.additions.delete(id);
    return answer(200, { success: true });
  }
  return answer(200, aggregationJson(held));
}

function metricOf(aggregation: FakeAggregation, input: PolicyInput): bigint {
  const { metric } = aggregation.body;
  if (metric.field_source === "ethereum_transaction") {
    return metric.field === "value" ? input.valueWei : 0n;
  }
  const read = readCalldataField(metric.abi ?? [], metric.field, input.data);
  return typeof read === "bigint" ? read : 0n;
}

/**
 * What a request adds to an aggregation, as Privy's docs describe it: nothing when its conditions
 * fail; otherwise its metric, or 0 when the metric cannot be read from it.
 */
function addedBy(aggregation: FakeAggregation, input: PolicyInput): bigint {
  return conditionsHold(aggregation.body.conditions, input) ? metricOf(aggregation, input) : 0n;
}

/** The sum of the additions inside a rolling window that ends now, both in milliseconds. */
export function windowSum(
  additions: readonly FakeAddition[],
  window: { readonly seconds: number; readonly nowMs: number },
): bigint {
  const startMs = window.nowMs - window.seconds * 1_000;
  return additions
    .filter((item) => item.atMs > startMs && item.atMs <= window.nowMs)
    .reduce((sum, item) => sum + item.value, 0n);
}

/**
 * The sums the policy engine compares for the app, read forward: what each aggregation holds
 * over its window now, plus what the request adds. A deleted aggregation has no sum.
 */
export function referencesOf(state: FakePrivyState): FakeReferences {
  return (id, input) => {
    const aggregation = state.aggregations.get(id);
    if (aggregation === undefined) {
      return undefined;
    }
    const held = state.additions.get(id) ?? [];
    const nowMs = state.clock.now();
    const sum = windowSum(held, { seconds: aggregation.body.window.seconds, nowMs });
    return sum + addedBy(aggregation, input);
  };
}

/** The aggregations a set of policies names in their reference conditions, each once. */
export function namedAggregations(policies: readonly FakePolicy[]): readonly string[] {
  const named = policies.flatMap((policy) =>
    policy.rules.flatMap((rule) =>
      rule.conditions.flatMap((condition) =>
        condition.field_source === "reference"
          ? [condition.field.slice("aggregation.".length)]
          : [],
      ),
    ),
  );
  return [...new Set(named)];
}

/**
 * Records a request Privy signed in each aggregation the wallet's policies name, as Privy does
 * after signing: what the request adds, at the fake's time. Requests it refused are not recorded.
 */
export function recordSigned(
  state: FakePrivyState,
  signed: { readonly aggregations: readonly string[]; readonly input: PolicyInput },
): void {
  const atMs = state.clock.now();
  for (const id of signed.aggregations) {
    const aggregation = state.aggregations.get(id);
    if (aggregation !== undefined) {
      const value = addedBy(aggregation, signed.input);
      state.additions.set(id, [...(state.additions.get(id) ?? []), { atMs, value }]);
    }
  }
}
