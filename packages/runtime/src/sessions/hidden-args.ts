import { type JsonValue, jsonValueSchema } from "@binference/core";
import { z } from "zod";
import type { ResponseReplay } from "../loop/model-event.js";
import type { ToolCall } from "../loop/model-message.js";
import type { TurnJournal } from "../loop/ports.js";
import type { ResponseRecord } from "../loop/turn-records.js";
import { replayBlocksOf } from "../providers/messages-replay.schema.js";

/** The arguments of each tool that the transcript never keeps, by the tool's name. */
export type HiddenArgs = ReadonlyMap<string, readonly string[]>;

/** What a hidden argument's value reads as in the transcript. */
const hiddenValue = "(hidden)";

const argumentsSchema = z.record(z.string(), jsonValueSchema);

function hideFields(
  record: Readonly<Record<string, JsonValue>>,
  fields: readonly string[],
): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, fields.includes(key) ? hiddenValue : value]),
  );
}

// A call's arguments with its hidden ones replaced; arguments that are no JSON object are dropped
// whole, since what they hold cannot be told apart.
function hiddenArguments(text: string, fields: readonly string[]): string {
  try {
    const parsed = argumentsSchema.safeParse(JSON.parse(text));
    return parsed.success ? JSON.stringify(hideFields(parsed.data, fields)) : "{}";
  } catch {
    return "{}";
  }
}

// A tool call as the transcript keeps it: each argument its tool hides replaced.
function hideCall(call: ToolCall, hidden: HiddenArgs): ToolCall {
  const fields = hidden.get(call.name);
  return fields === undefined
    ? call
    : { ...call, argumentsText: hiddenArguments(call.argumentsText, fields) };
}

// A response's replay with the hidden arguments of its tool calls replaced; a replay that cannot
// be read is not kept once a call of a tool that hides arguments may be in it.
function hideReplay(replay: ResponseReplay, hidden: HiddenArgs): ResponseReplay | undefined {
  const blocks = replayBlocksOf(replay.content);
  if (blocks === undefined) {
    return [...hidden.keys()].some((name) => JSON.stringify(replay.content).includes(name))
      ? undefined
      : replay;
  }
  const content = blocks.map((block) => {
    const fields = block.type === "tool_use" ? hidden.get(block.name) : undefined;
    return block.type === "tool_use" && fields !== undefined
      ? { type: block.type, id: block.id, name: block.name, input: hideFields(block.input, fields) }
      : block;
  });
  return { ...replay, content: jsonValueSchema.parse(content) };
}

function hideResponse(response: ResponseRecord, hidden: HiddenArgs): ResponseRecord {
  if (response.replay === undefined) {
    return response;
  }
  const { replay, ...rest } = response;
  const kept = hideReplay(replay, hidden);
  return kept === undefined ? rest : { ...rest, replay: kept };
}

/**
 * A turn's journal that never writes the arguments a tool hides, such as a PDF's password
 * (decision 0402): in a call, a proposal or a response's replay, each reads `(hidden)`. The model
 * still reads them for the rest of its turn; later turns read the transcript.
 */
export function withHiddenArgs(journal: TurnJournal, hidden: HiddenArgs): TurnJournal {
  return {
    ...journal,
    response: async (response, signal) => journal.response(hideResponse(response, hidden), signal),
    toolCall: async (call, signal) => journal.toolCall(hideCall(call, hidden), signal),
    proposal: async (proposal, signal) =>
      journal.proposal({ ...proposal, call: hideCall(proposal.call, hidden) }, signal),
  };
}
