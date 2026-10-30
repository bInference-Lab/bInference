import { z } from "zod";
import { isSolanaNodeFault } from "./solana-node-fault.js";

/** Why an endpoint failed a call, so the next one was asked. */
export type EndpointFault =
  | "timeout"
  | "unreachable"
  | "rate_limited"
  | "bad_status"
  | "malformed"
  | "node_error";

/** A JSON-RPC answer, its integers as `bigint`, for the SDK's own response transformers. */
export interface SolanaAnswer {
  readonly body: unknown;
}

/** What one endpoint gave a call: an answer, or a failure that sends the call on. */
export type SolanaOutcome =
  | { readonly kind: "answer"; readonly answer: SolanaAnswer }
  | { readonly kind: "fault"; readonly fault: EndpointFault };

interface SourceContext {
  readonly source?: string;
}

const integerText = /^-?(?:0|[1-9]\d*)$/;
const methodSchema = z.looseObject({ method: z.string() });
const errorSchema = z.looseObject({
  error: z.looseObject({ code: z.bigint() }),
});
const resultSchema = z.looseObject({ result: z.unknown() });

// Every integer as a bigint, as Solana's own SDK parses its answers, so a u64 such as a lamport
// balance above 2^53 keeps its value.
function parseJsonWithIntegers(text: string): unknown {
  return JSON.parse(text, (_key, value: unknown, context?: SourceContext) =>
    typeof value === "number" && integerText.test(context?.source ?? "")
      ? BigInt(context?.source ?? "0")
      : value,
  );
}

/** The method a request names, read from the SDK's payload. */
export function methodOf(payload: unknown): string {
  return methodSchema.parse(payload).method;
}

// JSON.rawJSON (ES2025, in every Node.js binference runs on) writes a bigint as a plain JSON
// number; ES2023's lib does not declare it, so it is read and checked once here.
const rawJsonSchema = z.custom<(text: string) => object>((value) => typeof value === "function");
const rawJson = rawJsonSchema.parse(Reflect.get(JSON, "rawJSON"));

/**
 * Writes a Solana RPC request, a `bigint` such as a slot as a plain JSON number, as Solana's own
 * SDK writes it. The SDK refuses one past 2^53 before it reaches here.
 */
export function stringifyRequest(payload: unknown): string {
  return JSON.stringify(payload, (_key, item: unknown) =>
    typeof item === "bigint" ? rawJson(item.toString()) : item,
  );
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

/**
 * Reads one endpoint's HTTP answer. A 429 or 403 is the endpoint's rate limit; a node's own
 * JSON-RPC error, another status outside 2xx, or a body that is no JSON-RPC answer is a fault; a
 * JSON-RPC error about the call itself, such as bad params, is the call's answer.
 */
export function readSolanaAnswer(status: number, text: string): SolanaOutcome {
  if (status === 429 || status === 403) {
    return { kind: "fault", fault: "rate_limited" };
  }
  let body: unknown;
  try {
    body = parseJsonWithIntegers(text);
  } catch {
    return { kind: "fault", fault: isSuccess(status) ? "malformed" : "bad_status" };
  }
  const error = errorSchema.safeParse(body);
  if (error.success) {
    return isSolanaNodeFault(error.data.error.code)
      ? { kind: "fault", fault: "node_error" }
      : { kind: "answer", answer: { body } };
  }
  if (!isSuccess(status)) {
    return { kind: "fault", fault: "bad_status" };
  }
  return resultSchema.safeParse(body).success
    ? { kind: "answer", answer: { body } }
    : { kind: "fault", fault: "malformed" };
}
