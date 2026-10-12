import type { ModelMessage, ToolDeclaration } from "../loop/model-message.js";
import type { ModelRequest } from "../loop/turn-records.js";

// Ideographs, kana, Hangul, Bopomofo, CJK punctuation and full-width forms: one token each.
const cjkClasses = [
  String.raw`\p{Script=Han}`,
  String.raw`\p{Script=Hiragana}`,
  String.raw`\p{Script=Katakana}`,
  String.raw`\p{Script=Hangul}`,
  String.raw`\p{Script=Bopomofo}`,
  String.raw`\u3000-\u303f`,
  String.raw`\uff00-\uffef`,
];
const cjkPattern = new RegExp(`[${cjkClasses.join("")}]`, "u");

/** Other text: one token per this many characters. */
const charactersPerToken = 4;

/**
 * What each message costs beside its text: OpenAI's published counting rules give each chat
 * message 3 tokens and its role 1.
 */
const tokensPerMessage = 4;

/** What a request costs beside its messages: the 3 tokens that open the model's answer. */
const tokensPerRequest = 3;

/**
 * The estimated tokens of a text (runtime spec, section 7.3): a CJK character counts as one
 * token, and other text as one token per 4 characters, rounded up.
 */
export function estimateTextTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const character of text) {
    if (cjkPattern.test(character)) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return cjk + Math.ceil(other / charactersPerToken);
}

/** The texts a message sends the model: its words, its reasoning, and its calls or result. */
export function messageTexts(message: ModelMessage): readonly string[] {
  if (message.role === "agent") {
    const calls = message.toolCalls.flatMap((call) => [call.name, call.argumentsText]);
    return [message.text, message.reasoning, ...calls];
  }
  return message.role === "tool" ? [message.name, message.text] : [message.text];
}

/** The estimated tokens of one message of the conversation, with its own overhead. */
export function estimateMessageTokens(message: ModelMessage): number {
  const texts = messageTexts(message).reduce((sum, text) => sum + estimateTextTokens(text), 0);
  return tokensPerMessage + texts;
}

/** The estimated tokens of a run of messages. */
export function estimateMessagesTokens(messages: readonly ModelMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

function declarationsTokens(tools: readonly ToolDeclaration[]): number {
  return tools.length === 0 ? 0 : estimateTextTokens(JSON.stringify(tools));
}

/** The estimated input tokens of a whole model call: prefix, tools, history and tail. */
export function estimateRequestTokens(request: ModelRequest): number {
  return (
    tokensPerRequest +
    estimateTextTokens(request.prefix) +
    declarationsTokens(request.tools) +
    estimateMessagesTokens(request.messages) +
    (request.tail === undefined ? 0 : tokensPerMessage + estimateTextTokens(request.tail))
  );
}
