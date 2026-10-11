import {
  BinferenceError,
  createDeadline,
  type HttpResponse,
  type JsonValue,
} from "@binference/core";
import type { AggregationDefinition } from "../ceiling/day-caps.js";
import { abiFunctionJson, policyConditionJson } from "../ceiling/policy-rule.js";
import { type PrivyCall, privyFault, statusFault } from "./privy-call.js";
import type { PrivySettings } from "./privy-client.js";
import type { PrivyId } from "./privy-records.js";
import { readAggregationAnswer } from "./privy-wire.schema.js";

/** An aggregation to make: what it sums, and the key quorum that owns it. */
export interface AggregationRequest {
  readonly definition: AggregationDefinition;
  readonly owner: PrivyId;
}

const path = "/v1/aggregations";
const call: Pick<PrivyCall<never>, "kind" | "path"> = { kind: "write", path };

function bodyOf({ definition, owner }: AggregationRequest): JsonValue {
  const { metric } = definition;
  return {
    name: definition.name,
    method: "eth_signTransaction",
    metric: {
      field: metric.field,
      field_source: metric.fieldSource,
      function: "sum",
      ...(metric.abi === undefined ? {} : { abi: [abiFunctionJson(metric.abi)] }),
    },
    window: { type: "rolling", seconds: definition.windowSeconds },
    conditions: definition.conditions.map(policyConditionJson),
    owner_id: owner,
  };
}

async function sent(
  settings: PrivySettings,
  request: AggregationRequest,
  signal: AbortSignal,
): Promise<HttpResponse> {
  const basic = Buffer.from(`${settings.appId}:${settings.appSecret.reveal()}`).toString("base64");
  try {
    return await settings.http.request({
      method: "POST",
      url: `${settings.origin}${path}`,
      headers: {
        authorization: `Basic ${basic}`,
        "privy-app-id": settings.appId,
        "content-type": "application/json",
      },
      body: JSON.stringify(bodyOf(request)),
      signal,
    });
  } catch (error) {
    // No answer, whatever the cause: the write's outcome is unknown, so nothing asks again.
    throw new BinferenceError({
      code: "custody.privy_unreachable",
      message: "Privy's API gave no answer in time.",
      details: { path },
      ...(error instanceof Error ? { cause: error } : {}),
    });
  }
}

/**
 * Makes one aggregation on Privy, once, owned by the key quorum given (decision 0149). Privy's
 * Node SDK has no call for it, so this is the one request the package writes by hand, as Privy's
 * stateful-policy recipe does: `POST /v1/aggregations` with the app's Basic auth, through the
 * `Http` port, within the call's timeout. Answers the aggregation's id once Privy's answer names
 * the owner and the window asked. Faults as every write: busy, refused credentials, refused,
 * failed, unreachable, malformed.
 */
export async function createAggregation(
  settings: PrivySettings,
  request: AggregationRequest,
  signal: AbortSignal,
): Promise<PrivyId> {
  signal.throwIfAborted();
  const deadline = createDeadline({ clock: settings.clock, signal, timeoutMs: settings.timeoutMs });
  try {
    const response = await sent(settings, request, deadline.signal);
    const { record: made, code } = readAggregationAnswer(response.body);
    if (response.status < 200 || response.status > 299) {
      throw statusFault(call, { status: response.status, ...(code === undefined ? {} : { code }) });
    }
    const { owner, definition } = request;
    if (made?.ownerId !== owner || made.windowSeconds !== definition.windowSeconds) {
      throw privyFault("custody.privy_malformed", call);
    }
    return made.id;
  } finally {
    signal.throwIfAborted();
    deadline.clear();
  }
}
