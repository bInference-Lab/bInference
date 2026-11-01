import { BinferenceError, type NoBridgeRoute } from "@binference/plugin-sdk";
import { parseJsonText } from "@binference/plugin-sdk/data";
import { z } from "zod";

/** A kind of answer that is a fault, named after it. */
type FaultKind = "bad_request" | "rate_limited" | "unavailable";

/**
 * What an Across answer that is no quote means to the bridge: a reason it has no route, which is
 * an answer (decision 0317), or a fault named after its kind.
 */
export type AnswerKind = NoBridgeRoute | FaultKind;

const faultKinds: ReadonlySet<AnswerKind> = new Set(["bad_request", "rate_limited", "unavailable"]);

/** Whether an answer's kind is a reason for no route, not a fault. */
export function isNoRoute(kind: AnswerKind): kind is NoBridgeRoute {
  return !faultKinds.has(kind);
}

// Each code of Across's API error list (`AcrossErrorCode` in its app SDK, which the docs point
// to), and `LOW_BRIDGE_LIQUIDITY`, which the live API gave on 2026-11-01 though no list names it.
// An amount under or over the route's limits, or over what its relayers hold, names its reason; a
// route Across does not enable and a quote it cannot give are no route; a request it refuses is
// this bridge's mistake; the rest are Across's faults.
const answerKinds: Readonly<Record<string, AnswerKind>> = {
  AMOUNT_TOO_LOW: "amount_too_low",
  AMOUNT_TOO_HIGH: "amount_too_high",
  LOW_BRIDGE_LIQUIDITY: "low_liquidity",
  SWAP_LIQUIDITY_INSUFFICIENT: "low_liquidity",
  ROUTE_NOT_ENABLED: "no_route",
  SWAP_QUOTE_UNAVAILABLE: "no_route",
  SWAP_TYPE_NOT_GUARANTEED: "no_route",
  INVALID_PARAM: "bad_request",
  MISSING_PARAM: "bad_request",
  INVALID_METHOD: "bad_request",
  ABI_ENCODING_ERROR: "bad_request",
  SIMULATION_ERROR: "unavailable",
  UPSTREAM_RPC_ERROR: "unavailable",
  UPSTREAM_HTTP_ERROR: "unavailable",
  UPSTREAM_GATEWAY_TIMEOUT: "unavailable",
  UNEXPECTED_ERROR: "unavailable",
};

// An invalid token or chain, or no named parameter at all ("No bridge routes found for 56 ->
// 8453", seen while Across served nothing from BSC on 2026-10-30), is Across saying it has no such
// route; an invalid wallet or amount is the request's mistake.
const routeParams: ReadonlySet<string> = new Set([
  "inputToken",
  "outputToken",
  "originChainId",
  "destinationChainId",
]);

const errorSchema = z.looseObject({
  type: z.literal("AcrossApiError"),
  code: z.string().max(64),
  param: z.string().max(64).optional(),
});

/** Across's error code and the parameter it names, or `undefined` for another answer. */
function readError(body: string): { code: string; param?: string } | undefined {
  const parsed = errorSchema.safeParse(parseJsonText(body));
  if (!parsed.success) {
    return undefined;
  }
  const { code, param } = parsed.data;
  return param === undefined ? { code } : { code, param };
}

/**
 * What an answer means: by Across's code when the body carries one, an invalid parameter by the
 * parameter it names; else by the HTTP status (429 a rate limit, anything else unavailable),
 * never a guess at a route.
 */
export function answerKindOf(status: number, body: string): AnswerKind {
  const error = readError(body);
  const kind = error === undefined ? undefined : answerKinds[error.code];
  if (kind === "bad_request" && error?.code === "INVALID_PARAM") {
    return error.param === undefined || routeParams.has(error.param) ? "no_route" : kind;
  }
  if (kind !== undefined) {
    return kind;
  }
  return status === 429 ? "rate_limited" : "unavailable";
}

/**
 * The fault for an answer that is no route and no result. It names Across's code and the HTTP
 * status, never Across's text, so no echo of a request reaches a log.
 */
export function answerFault(
  kind: FaultKind,
  answer: { readonly call: string; readonly status: number; readonly body: string },
): BinferenceError {
  const code = readError(answer.body)?.code ?? "none";
  return new BinferenceError({
    code: `across.${kind}`,
    message: `Across's API refused ${answer.call} (HTTP ${String(answer.status)}, ${code}).`,
    retryable: kind === "rate_limited" || kind === "unavailable",
    details: { status: answer.status, answer: code },
  });
}
