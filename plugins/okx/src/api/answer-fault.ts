import { BinferenceError } from "@binference/plugin-sdk";

/**
 * What OKX's answer codes mean to the venue, from its error code list. `no_route` is an answer;
 * every other kind is a fault named after it.
 */
export type AnswerKind =
  | "no_route"
  | "rate_limited"
  | "unavailable"
  | "bad_key"
  | "clock_skew"
  | "bad_request";

// Each documented code of the Swap API. Codes for Sui objects, commissions the venue never asks
// for, and approvals on chains without them are mistakes of the request here.
const answerKinds: Readonly<Record<string, AnswerKind>> = {
  "50011": "rate_limited",
  "50014": "bad_request",
  "50026": "unavailable",
  "50103": "bad_key",
  "50104": "bad_key",
  "50105": "bad_key",
  "50106": "bad_key",
  "50107": "bad_key",
  "50111": "bad_key",
  "50112": "clock_skew",
  "50113": "bad_key",
  "51000": "bad_request",
  "80000": "rate_limited",
  "80001": "unavailable",
  "80002": "bad_request",
  "80003": "bad_request",
  "80004": "bad_request",
  "80005": "bad_request",
  "82000": "no_route",
  "82001": "unavailable",
  "82003": "bad_request",
  "82004": "bad_request",
  "82005": "bad_request",
  "82102": "no_route",
  "82103": "no_route",
  "82104": "no_route",
  "82105": "bad_request",
  "82112": "no_route",
  "82116": "unavailable",
  "82130": "bad_request",
};

/**
 * What an answer means: by OKX's code when the body carries one it documents, else by the HTTP
 * status (429 is a rate limit, 401 a refused key, 5xx a service fault). Anything else is
 * `unavailable`, never a guess at a route.
 */
export function answerKindOf(status: number, code: string | undefined): AnswerKind {
  const known = code === undefined ? undefined : answerKinds[code];
  if (known !== undefined) {
    return known;
  }
  if (status === 429) {
    return "rate_limited";
  }
  return status === 401 ? "bad_key" : "unavailable";
}

// Waiting helps a rate limit, a service fault and a stamp OKX read late; a key or request it
// refuses stays refused.
const retryableKinds: ReadonlySet<AnswerKind> = new Set([
  "rate_limited",
  "unavailable",
  "clock_skew",
]);

/**
 * The fault for an answer that is no route and no result. It names OKX's code and the HTTP
 * status, never OKX's text and never a header, so no key reaches a log.
 */
export function answerFault(
  kind: Exclude<AnswerKind, "no_route">,
  answer: { readonly call: string; readonly status: number; readonly code: string | undefined },
): BinferenceError {
  return new BinferenceError({
    code: `okx.${kind}`,
    message: `OKX's API refused ${answer.call} (HTTP ${String(answer.status)}).`,
    retryable: retryableKinds.has(kind),
    details: { status: answer.status, answer: answer.code ?? "none" },
  });
}
