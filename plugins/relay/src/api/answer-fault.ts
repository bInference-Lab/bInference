import { BinferenceError, type NoBridgeRoute } from "@binference/plugin-sdk";
import { parseJsonText } from "@binference/plugin-sdk/data";
import { z } from "zod";

/** A kind of answer that is a fault, named after it. */
type FaultKind = "bad_request" | "unauthorized" | "rate_limited" | "unavailable";

/**
 * What a Relay answer that is no quote means to the bridge: a reason it has no route, which is an
 * answer (decision 0317), or a fault named after its kind.
 */
export type AnswerKind = NoBridgeRoute | FaultKind;

const faultKinds: ReadonlySet<AnswerKind> = new Set([
  "bad_request",
  "unauthorized",
  "rate_limited",
  "unavailable",
]);

/** Whether an answer's kind is a reason for no route, not a fault. */
export function isNoRoute(kind: AnswerKind): kind is NoBridgeRoute {
  return !faultKinds.has(kind);
}

// Each code of Relay's quote error list (its "Handling Quote Errors" guide, expected and
// unexpected). An amount under or over the route's limits, or over its solvers' liquidity, names
// its reason; a chain, token or route Relay does not serve now, a token or wallet it will not
// touch, and a swap it judges too costly are no route; a request it refuses is this bridge's
// mistake; a missing or refused API key is the owner's to fix; the rest are Relay's faults.
// `BLOCKED_WALLET_ADDRESS`, which no list names, Relay's API gave on 2026-11-01 for a wallet its
// screening blocks, a wallet it will not touch.
const answerKinds: Readonly<Record<string, AnswerKind>> = {
  AMOUNT_TOO_LOW: "amount_too_low",
  AMOUNT_TOO_HIGH: "amount_too_high",
  INSUFFICIENT_LIQUIDITY: "low_liquidity",
  BLOCKED_WALLET_ADDRESS: "no_route",
  CHAIN_DISABLED: "no_route",
  INVALID_INPUT_CURRENCY: "no_route",
  INVALID_OUTPUT_CURRENCY: "no_route",
  INVALID_RECIPIENT: "no_route",
  NO_INTERNAL_SWAP_ROUTES_FOUND: "no_route",
  NO_QUOTES: "no_route",
  NO_SWAP_ROUTES_FOUND: "no_route",
  SANCTIONED_CURRENCY: "no_route",
  SANCTIONED_WALLET_ADDRESS: "no_route",
  SWAP_IMPACT_TOO_HIGH: "no_route",
  UNSUPPORTED_CHAIN: "no_route",
  UNSUPPORTED_CURRENCY: "no_route",
  UNSUPPORTED_ROUTE: "no_route",
  EXTRA_TXS_NOT_SUPPORTED: "bad_request",
  INSUFFICIENT_FUNDS: "bad_request",
  INVALID_ADDRESS: "bad_request",
  INVALID_EXTRA_TXS: "bad_request",
  INVALID_GAS_LIMIT_FOR_DEPOSIT_SPECIFIED_TXS: "bad_request",
  INVALID_SLIPPAGE_TOLERANCE: "bad_request",
  PERMIT_FAILED: "bad_request",
  SOLANA_TX_TOO_LARGE: "bad_request",
  UNSUPPORTED_EXECUTION_TYPE: "bad_request",
  USER_RECIPIENT_MISMATCH: "bad_request",
  FORBIDDEN: "unauthorized",
  UNAUTHORIZED: "unauthorized",
  UNAUTHORIZED_QUOTE: "unauthorized",
  ROUTE_TEMPORARILY_RESTRICTED: "rate_limited",
  DESTINATION_TX_FAILED: "unavailable",
  ERC20_ROUTER_ADDRESS_NOT_FOUND: "unavailable",
  PRICE_FETCH_FAILED: "unavailable",
  REQUEST_TIMED_OUT: "unavailable",
  RPC_HTTP_ERROR: "unavailable",
  SERVICE_UNAVAILABLE: "unavailable",
  SWAP_QUOTE_FAILED: "unavailable",
  UNKNOWN_ERROR: "unavailable",
};

const errorSchema = z.looseObject({ errorCode: z.string().max(64) });

/** Relay's error code, or `undefined` for an answer that names none. */
function readCode(body: string): string | undefined {
  const parsed = errorSchema.safeParse(parseJsonText(body));
  return parsed.success ? parsed.data.errorCode : undefined;
}

// The codes Relay's errors guide asks a client to try again after a pause before it surfaces
// them: a price, a node or Relay itself that did not answer in time.
const passingCodes: ReadonlySet<string> = new Set([
  "PRICE_FETCH_FAILED",
  "REQUEST_TIMED_OUT",
  "RPC_HTTP_ERROR",
  "SERVICE_UNAVAILABLE",
]);

/** Whether an answer names a code Relay's guide asks to try again once, after a pause. */
export function isPassingAnswer(body: string): boolean {
  const code = readCode(body);
  return code !== undefined && passingCodes.has(code);
}

/**
 * What an answer means: by Relay's code when the body carries one; else by the HTTP status (401
 * and 403 the key, 429 a rate limit, anything else unavailable), never a guess at a route.
 */
export function answerKindOf(status: number, body: string): AnswerKind {
  const code = readCode(body);
  const kind = code === undefined ? undefined : answerKinds[code];
  if (kind !== undefined) {
    return kind;
  }
  if (status === 401 || status === 403) {
    return "unauthorized";
  }
  return status === 429 ? "rate_limited" : "unavailable";
}

// What each fault tells a person to do next.
const nextSteps: Readonly<Record<FaultKind, string>> = {
  bad_request: "This build of binference sent a request Relay refuses.",
  unauthorized: "Set venues.keys.relay to a Relay API key from Relay's dashboard.",
  rate_limited: "Relay is limiting requests; the bridge asks again later.",
  unavailable: "Relay could not answer; the bridge asks again later.",
};

/**
 * The fault for an answer that is no route and no result. It names Relay's code and the HTTP
 * status, never Relay's text, so no echo of a request reaches a log; a rate limit and Relay's own
 * faults are retryable.
 */
export function answerFault(
  kind: FaultKind,
  answer: { readonly call: string; readonly status: number; readonly body: string },
): BinferenceError {
  const code = readCode(answer.body) ?? "none";
  return new BinferenceError({
    code: `relay.${kind}`,
    message: `Relay's API refused ${answer.call} (HTTP ${String(answer.status)}, ${code}). ${nextSteps[kind]}`,
    retryable: kind === "rate_limited" || kind === "unavailable",
    details: { status: answer.status, answer: code },
  });
}

/**
 * The fault for an answer that is neither a result nor a reason for no route: where no route
 * cannot be the answer, such as for a status read, that reason reads as Relay unavailable.
 */
export function unansweredFault(
  call: string,
  response: { readonly status: number; readonly body: string },
): BinferenceError {
  const kind = answerKindOf(response.status, response.body);
  return answerFault(isNoRoute(kind) ? "unavailable" : kind, { call, ...response });
}
