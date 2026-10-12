import type {
  ContentBlockParam,
  MessageCreateParamsStreaming,
  MessageParam,
  TextBlockParam,
  Tool,
  ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages";
import type { ResponseReplay } from "../loop/model-event.js";
import type { ModelMessage, ToolDeclaration } from "../loop/model-message.js";
import type { ModelRequest } from "../loop/turn-records.js";
import { inputObjectOf, replayBlocksOf } from "./messages-replay.schema.js";

/**
 * The most output tokens one call asks for (runtime spec, section 8.1): the gateway reserves them
 * from the agent's credit before it answers, and every transport asks for the same.
 */
const maxOutputTokens = 4_096;

// Anthropic caches a prompt only up to a mark the request places, at most four of them; the marks
// cache tools, then the system prompt, then the messages, in that order.
const mark = { type: "ephemeral" } as const;

// A response the transport kept goes back exactly as it came, its thinking blocks' signatures
// with it; one with no replay, or another format's, is written from its text and calls.
function replayed(replay: ResponseReplay | undefined): ContentBlockParam[] | undefined {
  if (replay?.format !== "messages") {
    return undefined;
  }
  const blocks = replayBlocksOf(replay.content);
  return blocks === undefined ? undefined : [...blocks];
}

function agentBlocks(entry: Extract<ModelMessage, { role: "agent" }>): ContentBlockParam[] {
  const text: ContentBlockParam[] = entry.text === "" ? [] : [{ type: "text", text: entry.text }];
  const calls = entry.toolCalls.map((call): ContentBlockParam => ({
    type: "tool_use",
    id: call.id,
    name: call.name,
    input: inputObjectOf(call.argumentsText),
  }));
  return replayed(entry.replay) ?? [...text, ...calls];
}

function toolResult(entry: Extract<ModelMessage, { role: "tool" }>): ToolResultBlockParam {
  return {
    type: "tool_result",
    tool_use_id: entry.callId,
    // The API refuses an empty text block; a result with no text goes without content.
    ...(entry.text === "" ? {} : { content: entry.text }),
    ...(entry.isError ? { is_error: true } : {}),
  };
}

function blocksOf(entry: ModelMessage): {
  role: "user" | "assistant";
  blocks: ContentBlockParam[];
} {
  if (entry.role === "agent") {
    return { role: "assistant", blocks: agentBlocks(entry) };
  }
  if (entry.role === "tool") {
    return { role: "user", blocks: [toolResult(entry)] };
  }
  return { role: "user", blocks: entry.text === "" ? [] : [{ type: "text", text: entry.text }] };
}

// One message per run of entries of one side: a response's results and the owner's messages held
// behind them go as one user message, the results first, as the API asks.
function messagesOf(conversation: readonly ModelMessage[]): MessageParam[] {
  const messages: { role: "user" | "assistant"; content: ContentBlockParam[] }[] = [];
  for (const entry of conversation) {
    const { role, blocks } = blocksOf(entry);
    const last = messages.at(-1);
    if (blocks.length === 0) {
      continue;
    }
    if (last?.role === role) {
      last.content.push(...blocks);
    } else {
      messages.push({ role, content: blocks });
    }
  }
  return messages;
}

// The last owner text or tool result ends the history, the cache's second mark (runtime spec,
// section 7.1). Thinking and calls the model wrote take no mark.
function withHistoryMark(messages: MessageParam[]): MessageParam[] {
  const end = messages.findLastIndex((message) => message.role === "user");
  const message = messages[end];
  if (message === undefined || typeof message.content === "string") {
    return messages;
  }
  const blocks = message.content;
  const last = blocks.at(-1);
  const marked =
    last?.type === "text" || last?.type === "tool_result"
      ? [...blocks.slice(0, -1), { ...last, cache_control: mark }]
      : blocks;
  return messages.with(end, { ...message, content: marked });
}

// The arguments' JSON Schema as the API takes it: an object schema without its `$schema` line.
function toolOf(declaration: ToolDeclaration): Tool {
  const { $schema: _draft, ...shape } = declaration.parameters;
  return {
    name: declaration.name,
    description: declaration.description,
    input_schema: { ...shape, type: "object" },
  };
}

// The tools, with a mark on the last one: the tool list caches on its own when the system
// prompt changes.
function toolsOf(declarations: readonly ToolDeclaration[]): Tool[] {
  const tools = declarations.map(toolOf);
  const last = tools.at(-1);
  return last === undefined ? [] : tools.with(tools.length - 1, { ...last, cache_control: mark });
}

function systemOf(prefix: string): TextBlockParam[] {
  return prefix === "" ? [] : [{ type: "text", text: prefix, cache_control: mark }];
}

// The live facts after the history's mark: a text block of the last user message, or a user
// message of their own after the model's, so the roles still alternate.
function withTail(messages: MessageParam[], tail: string | undefined): MessageParam[] {
  if (tail === undefined) {
    return messages;
  }
  const block: TextBlockParam = { type: "text", text: tail };
  const last = messages.at(-1);
  if (last?.role !== "user" || typeof last.content === "string") {
    return [...messages, { role: "user", content: [block] }];
  }
  return messages.with(messages.length - 1, { ...last, content: [...last.content, block] });
}

/**
 * The Messages request for one model call (decisions 0187 and 0201): the stable prefix as a marked
 * system block, the tools with a mark on the last, the conversation as alternating user and
 * assistant messages with a mark at the end of the history, then the live facts unmarked, at most
 * 4,096 output tokens, and a streamed answer. A response the transport kept a replay for goes back
 * exactly as it came.
 */
export function messagesPayloadOf(
  request: ModelRequest,
  options: { readonly model: string },
): MessageCreateParamsStreaming {
  const system = systemOf(request.prefix);
  const tools = toolsOf(request.tools);
  return {
    model: options.model,
    max_tokens: maxOutputTokens,
    ...(system.length === 0 ? {} : { system }),
    ...(tools.length === 0 ? {} : { tools }),
    messages: withTail(withHistoryMark(messagesOf(request.messages)), request.tail),
    stream: true,
  };
}
