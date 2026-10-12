import type {
  ChatCompletionContentPartText,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

// Anthropic's models cache a prompt only up to a mark the request places, at most four of them.
// Through a Chat Completions gateway, a mark rides on a text part of a message; the gateway hands
// it to the model with the rest. Other providers cache a repeated prefix on their own and get none.
const anthropicModels = "anthropic/";
const mark = { type: "ephemeral" } as const;

// A message whose text may be one marked text part.
type MarkableMessage = Extract<ChatCompletionMessageParam, { role: "system" | "user" | "tool" }>;

function isMarkable(message: ChatCompletionMessageParam): message is MarkableMessage {
  return (
    (message.role === "system" || message.role === "user" || message.role === "tool") &&
    typeof message.content === "string" &&
    message.content !== ""
  );
}

function markedPart(text: string): ChatCompletionContentPartText {
  const part = { type: "text", text, cache_control: mark } as const;
  return part;
}

function marked(message: MarkableMessage): ChatCompletionMessageParam {
  return typeof message.content === "string"
    ? { ...message, content: [markedPart(message.content)] }
    : message;
}

// The history's last message the model reads as text: the owner's or a tool's.
function historyEnd(messages: readonly ChatCompletionMessageParam[]): number {
  return messages.findLastIndex((message) => isMarkable(message) && message.role !== "system");
}

/**
 * The messages with Anthropic's cache marks placed, for a model whose id starts with `anthropic/`:
 * one on the system message, which ends the stable prefix (the tools come before it in the cached
 * order), and one on the last owner or tool message, which ends the history (runtime spec,
 * section 7.1). Any other model's messages come back as they were.
 */
export function withCacheMarks(
  messages: readonly ChatCompletionMessageParam[],
  model: string,
): ChatCompletionMessageParam[] {
  if (!model.startsWith(anthropicModels)) {
    return [...messages];
  }
  const end = historyEnd(messages);
  return messages.map((message, index) => {
    const isPrefixEnd = index === 0 && message.role === "system";
    return (isPrefixEnd || index === end) && isMarkable(message) ? marked(message) : message;
  });
}
