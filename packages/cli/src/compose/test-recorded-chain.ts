import { type Http, type HttpResponse, type JsonValue, jsonValueSchema } from "@binference/core";
import { z } from "zod";

// A recording holds what a chain's public RPC answered for each call, by method and params.
const recordedSchema = z.object({
  answers: z.array(
    z.object({ method: z.string(), params: z.array(jsonValueSchema), result: jsonValueSchema }),
  ),
});
const callSchema = z.object({
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.array(jsonValueSchema).default([]),
});

const keyOf = (method: string, params: readonly JsonValue[]): string =>
  `${method}${JSON.stringify(params)}`;

/** A chain's JSON-RPC answered from recordings, with no network. */
export interface RecordedChain {
  /** Answers every endpoint's calls from what the chain holds so far. */
  readonly http: Http;
  /** Adds what the chain answers to one call, such as a fill that landed since. */
  answer(method: string, params: readonly JsonValue[], result: JsonValue): void;
  /** Each call no recording answered, as its method and params, oldest first. */
  unanswered(): readonly string[];
}

/**
 * A chain for tests whose JSON-RPC answers come from recordings, first `recording`'s, then those a
 * test adds; a call none holds gets an RPC error and is noted.
 */
export function createRecordedChain(recording: JsonValue = { answers: [] }): RecordedChain {
  const answers = new Map(
    recordedSchema
      .parse(recording)
      .answers.map(({ method, params, result }) => [keyOf(method, params), result]),
  );
  const missed: string[] = [];
  return {
    http: {
      async request(request): Promise<HttpResponse> {
        request.signal.throwIfAborted();
        const call = callSchema.parse(JSON.parse(request.body ?? "null"));
        const key = keyOf(call.method, call.params);
        const recorded = answers.get(key);
        if (recorded === undefined) {
          missed.push(key);
        }
        const reply =
          recorded === undefined
            ? { error: { code: -32_602, message: "not recorded" } }
            : { result: recorded };
        const body = JSON.stringify({ jsonrpc: "2.0", id: call.id, ...reply });
        return await Promise.resolve({ status: 200, headers: {}, body });
      },
    },
    answer: (method, params, result) => {
      answers.set(keyOf(method, params), result);
    },
    unanswered: () => [...missed],
  };
}
