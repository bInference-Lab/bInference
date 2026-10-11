import {
  BinferenceError,
  createDeadline,
  err,
  type HttpResponse,
  type JsonValue,
  ok,
  type Result,
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

/** One request to the aggregations API: its method, its path, and the body of a `POST`. */
interface AggregationCall {
  readonly method: "POST" | "DELETE";
  readonly path: string;
  readonly body?: JsonValue;
}

async function sent(
  settings: PrivySettings,
  request: AggregationCall,
  signal: AbortSignal,
): Promise<HttpResponse> {
  const basic = Buffer.from(`${settings.appId}:${settings.appSecret.reveal()}`).toString("base64");
  try {
    return await settings.http.request({
      method: request.method,
      url: `${settings.origin}${request.path}`,
      headers: {
        authorization: `Basic ${basic}`,
        "privy-app-id": settings.appId,
        ...(request.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      signal,
    });
  } catch (error) {
    // No answer, whatever the cause: the write's outcome is unknown, so nothing asks again.
    throw new BinferenceError({
      code: "custody.privy_unreachable",
      message: "Privy's API gave no answer in time.",
      details: { path: request.path },
      ...(error instanceof Error ? { cause: error } : {}),
    });
  }
}

// Sends one request within the call's timeout and hands its answer to `read`.
async function within<T>(
  settings: PrivySettings,
  request: AggregationCall,
  input: { readonly signal: AbortSignal; readonly read: (response: HttpResponse) => T },
): Promise<T> {
  const { signal } = input;
  signal.throwIfAborted();
  const deadline = createDeadline({ clock: settings.clock, signal, timeoutMs: settings.timeoutMs });
  try {
    return input.read(await sent(settings, request, deadline.signal));
  } finally {
    signal.throwIfAborted();
    deadline.clear();
  }
}

/**
 * Makes one aggregation on Privy, once, owned by the key quorum given (decision 0149). Privy's
 * Node SDK has no call for it, so the package writes this request by hand, as Privy's
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
  const post = { method: "POST", path, body: bodyOf(request) } as const;
  return within(settings, post, {
    signal,
    read: (response) => {
      const { record: made, code } = readAggregationAnswer(response.body);
      if (response.status < 200 || response.status > 299) {
        throw statusFault(call, {
          status: response.status,
          ...(code === undefined ? {} : { code }),
        });
      }
      const { owner, definition } = request;
      if (made?.ownerId !== owner || made.windowSeconds !== definition.windowSeconds) {
        throw privyFault("custody.privy_malformed", call);
      }
      return made.id;
    },
  });
}

/**
 * Deletes one aggregation (`DELETE /v1/aggregations/<id>`, the app's Basic auth), which Privy's
 * Node SDK does not offer either. Every policy condition that names it then reads false, so a
 * live ceiling that names it refuses every venue call; only the custody suite's cleanup calls
 * it. One Privy does not hold is `not_found`; other faults as every write.
 */
export async function deleteAggregation(
  settings: PrivySettings,
  aggregation: PrivyId,
  signal: AbortSignal,
): Promise<Result<void, "not_found">> {
  const removal = { method: "DELETE", path: `${path}/${aggregation}` } as const;
  return within(settings, removal, {
    signal,
    read: (response): Result<void, "not_found"> => {
      if (response.status === 404) {
        return err("not_found");
      }
      if (response.status < 200 || response.status > 299) {
        const { code } = readAggregationAnswer(response.body);
        throw statusFault(
          { ...call, path: removal.path },
          { status: response.status, ...(code === undefined ? {} : { code }) },
        );
      }
      return ok(undefined);
    },
  });
}
