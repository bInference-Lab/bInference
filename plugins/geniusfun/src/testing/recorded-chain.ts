import type { JsonValue } from "@binference/plugin-sdk";
import type { RpcFailover, RpcReply } from "@binference/plugin-sdk/evm";
import { z } from "zod";
import { type RecordedCall, recordedCalls } from "./recorded-answers.js";
import { recordedHeaders, type RecordedLog, recordedReceipts } from "./recorded-blocks.js";

/** A failover over recorded answers, which keeps the request of each call it was asked. */
export interface ScriptedChain extends RpcFailover {
  /** Each call asked, oldest first: its method and the key its answer is found by. */
  readonly asked: readonly string[];
}

/** Answers that replace or join the recorded ones, by the keys the recorded maps use. */
export interface ChainChanges {
  readonly calls?: ReadonlyMap<string, RecordedCall>;
  /** Each block's receipts, by its hex number, as the logs of each receipt. */
  readonly receipts?: ReadonlyMap<string, readonly (readonly RecordedLog[])[]>;
}

const callSchema = z.tuple([z.object({ to: z.string(), data: z.string() }), z.literal("latest")]);
const tagSchema = z.tuple([z.string()]).rest(z.json());

function replyOf<T>(answer: JsonValue | RecordedCall, result: z.ZodType<T>): RpcReply<T> {
  const endpoint = "recorded";
  if (answer !== null && typeof answer === "object" && "revert" in answer) {
    return { kind: "error", endpoint, code: 3, message: "execution reverted", data: answer.revert };
  }
  const value =
    answer !== null && typeof answer === "object" && "result" in answer ? answer.result : answer;
  return { kind: "result", endpoint, value: result.parse(value) };
}

interface Recorded {
  readonly calls: ReadonlyMap<string, RecordedCall>;
  readonly receipts: ReadonlyMap<string, readonly (readonly RecordedLog[])[]>;
}

function answerOf(
  method: string,
  params: readonly JsonValue[],
  recorded: Recorded,
): { readonly key: string; readonly answer: JsonValue | RecordedCall | undefined } {
  if (method === "eth_call") {
    const [{ to, data }] = callSchema.parse(params);
    const key = `${to.toLowerCase()}|${data}`;
    return { key, answer: recorded.calls.get(key) };
  }
  const [tag] = tagSchema.parse(params);
  if (method === "eth_getBlockByNumber") {
    const header = recordedHeaders.get(tag);
    return { key: tag, answer: header === undefined ? undefined : { ...header } };
  }
  const receipts = method === "eth_getBlockReceipts" ? recorded.receipts.get(tag) : undefined;
  const answer = receipts?.map((logs) => ({
    logs: logs.map((log) => ({ ...log, topics: [...log.topics] })),
  }));
  return { key: tag, answer };
}

/**
 * A failover that answers the venue's reads from the answers recorded on BNB Smart Chain, for
 * tests: each `eth_call` by contract and calldata, each header by its tag, each block's receipts
 * by its number. A call it holds no answer for throws, so a test never reads past what was
 * recorded. `changes` replaces or adds `eth_call` answers and blocks' receipts.
 */
export function scriptedChain(changes: ChainChanges = {}): ScriptedChain {
  const asked: string[] = [];
  const recorded: Recorded = {
    calls: new Map([...recordedCalls, ...(changes.calls ?? [])]),
    receipts: new Map([...recordedReceipts, ...(changes.receipts ?? [])]),
  };
  return {
    asked,
    async request(call) {
      call.signal.throwIfAborted();
      const { key, answer } = answerOf(call.method, call.params, recorded);
      asked.push(`${call.method} ${key}`);
      if (answer === undefined) {
        throw new Error(`No recorded answer for ${call.method} ${key}.`);
      }
      return await Promise.resolve(replyOf(answer, call.result));
    },
    health: () => [],
  };
}
