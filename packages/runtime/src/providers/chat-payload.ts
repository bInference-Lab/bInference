import type { JsonValue } from "@binference/core";
import type {
  ChatCompletionContentPart,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import type { ModelMessage, ToolDeclaration } from "../loop/model-message.js";
import type { ModelRequest } from "../loop/turn-records.js";
import { withCacheMarks } from "./cache-marks.js";

/**
 * The most output tokens one call asks for (runtime spec, section 8.1): the gateway reserves them
 * from the agent's credit before it answers.
 */
const maxOutputTokens = 4_096;

/** The model a payload names. */
export interface ChatPayloadOptions {
  /** The model's id at its provider, such as `anthropic/claude-sonnet-4.5`. */
  readonly model: string;
}

// A call the model wrote with no arguments goes back as an empty object: some providers refuse to
// read an empty text as JSON.
function argumentsText(text: string): string {
  return text === "" ? "{}" : text;
}

function agentMessage(entry: Extract<ModelMessage, { role: "agent" }>): ChatCompletionMessageParam {
  if (entry.toolCalls.length === 0) {
    return { role: "assistant", content: entry.text };
  }
  return {
    role: "assistant",
    // Some providers refuse an empty text beside tool calls; none refuses no text.
    content: entry.text === "" ? null : entry.text,
    tool_calls: entry.toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: argumentsText(call.argumentsText) },
    })),
  };
}

// The owner's images as `image_url` parts with a base64 data URL, before the text, in the order
// they came; a message without images stays one text.
function ownerMessage(entry: Extract<ModelMessage, { role: "owner" }>): ChatCompletionMessageParam {
  if (entry.images === undefined || entry.images.length === 0) {
    return { role: "user", content: entry.text };
  }
  const images = entry.images.map((image): ChatCompletionContentPart => ({
    type: "image_url",
    image_url: { url: `data:${image.contentType};base64,${image.data}` },
  }));
  const text: ChatCompletionContentPart[] =
    entry.text === "" ? [] : [{ type: "text", text: entry.text }];
  return { role: "user", content: [...images, ...text] };
}

// The reasoning a response held stays in the transcript: Chat Completions has no field to send
// it back in.
function messageOf(entry: ModelMessage): ChatCompletionMessageParam {
  if (entry.role === "owner") {
    return ownerMessage(entry);
  }
  if (entry.role === "tool") {
    return { role: "tool", tool_call_id: entry.callId, content: entry.text };
  }
  return agentMessage(entry);
}

// The arguments' JSON Schema without its `$schema` line, which names the draft and no shape;
// some providers refuse a key they do not know there.
function parametersOf(declaration: ToolDeclaration): { readonly [key: string]: JsonValue } {
  const { $schema: _draft, ...shape } = declaration.parameters;
  return shape;
}

function toolOf(declaration: ToolDeclaration): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: declaration.name,
      description: declaration.description,
      parameters: parametersOf(declaration),
    },
  };
}

// The stable prefix as the system message, then the history; the tail comes after the marks.
function historyOf(request: ModelRequest): ChatCompletionMessageParam[] {
  const system: ChatCompletionMessageParam[] =
    request.prefix === "" ? [] : [{ role: "system", content: request.prefix }];
  return [...system, ...request.messages.map(messageOf)];
}

// The live facts as the last user message: after the history, so they never end a cache.
function tailOf(request: ModelRequest): ChatCompletionMessageParam[] {
  return request.tail === undefined ? [] : [{ role: "user", content: request.tail }];
}

/**
 * The Chat Completions request for one model call (runtime spec, section 7.1): the stable prefix
 * as the system message, the conversation, the live facts as a user message after it, the tools
 * when there are any, at most 4,096 output tokens, and a streamed answer that ends with its usage.
 * A model of Anthropic's gets cache marks at the end of its stable prefix and of its history,
 * never on the live facts (decisions 0175 and 0201).
 */
export function chatPayloadOf(
  request: ModelRequest,
  options: ChatPayloadOptions,
): ChatCompletionCreateParamsStreaming {
  return {
    model: options.model,
    messages: [...withCacheMarks(historyOf(request), options.model), ...tailOf(request)],
    ...(request.tools.length === 0 ? {} : { tools: request.tools.map(toolOf) }),
    max_completion_tokens: maxOutputTokens,
    stream: true,
    stream_options: { include_usage: true },
  };
}
