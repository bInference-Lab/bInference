import type { ModelMessage, ToolDeclaration } from "../loop/model-message.js";
import type { ModelRequest } from "../loop/turn-records.js";

const hanPattern = /\p{Script=Han}/u;

// Kana, Hangul, Bopomofo, CJK punctuation and full-width forms: one token each.
const cjkClasses = [
  String.raw`\p{Script=Hiragana}`,
  String.raw`\p{Script=Katakana}`,
  String.raw`\p{Script=Hangul}`,
  String.raw`\p{Script=Bopomofo}`,
  String.raw`\u3000-\u303f`,
  String.raw`\uff00-\uffef`,
];
const cjkPattern = new RegExp(`[${cjkClasses.join("")}]`, "u");

/**
 * What 100 Han ideographs cost: the larger tokenizers split a share of them in two, so each counts
 * as 1.15 tokens.
 */
const hanTokensPerHundred = 115;

/** Other text: at least one token per this many characters. */
const charactersPerToken = 4;

/**
 * The pieces a tokenizer never joins: a number of up to 3 digits, a word, a run of symbols, or
 * spaces that no word follows.
 */
const piecePattern = /\p{N}{1,3}|\s?[^\s\p{L}\p{N}]+|\s?\p{L}+|\s+/gu;

/**
 * What each message costs beside its text: OpenAI's published counting rules give each chat
 * message 3 tokens and its role 1.
 */
const tokensPerMessage = 4;

/** What a request costs beside its messages: the 3 tokens that open the model's answer. */
const tokensPerRequest = 3;

/** One stretch of text without CJK: one token per 4 characters, or per piece when it has more. */
function runTokens(run: string, characters: number): number {
  if (characters === 0) {
    return 0;
  }
  const pieces = run.match(piecePattern)?.length ?? 0;
  return Math.max(Math.ceil(characters / charactersPerToken), pieces);
}

/**
 * The estimated tokens of a text (runtime spec, section 7.3, and decision 0203): a Han ideograph
 * counts as 1.15 tokens and any other CJK character as one; each stretch of other text counts one
 * token per 4 characters, or one per number, word or symbol run when those are more, as tickers
 * and amounts between CJK characters are.
 */
export function estimateTextTokens(text: string): number {
  let han = 0;
  let cjk = 0;
  let other = 0;
  let runStart = 0;
  let runCharacters = 0;
  let index = 0;
  for (const character of text) {
    const isHan = hanPattern.test(character);
    if (isHan || cjkPattern.test(character)) {
      other += runTokens(text.slice(runStart, index), runCharacters);
      runCharacters = 0;
      runStart = index + character.length;
      if (isHan) {
        han += 1;
      } else {
        cjk += 1;
      }
    } else {
      runCharacters += 1;
    }
    index += character.length;
  }
  other += runTokens(text.slice(runStart), runCharacters);
  return Math.ceil((han * hanTokensPerHundred) / 100) + cjk + other;
}

/** The texts a message sends the model: its words, its reasoning, and its calls or result. */
export function messageTexts(message: ModelMessage): readonly string[] {
  if (message.role === "agent") {
    const calls = message.toolCalls.flatMap((call) => [call.name, call.argumentsText]);
    return [message.text, message.reasoning, ...calls];
  }
  return message.role === "tool" ? [message.name, message.text] : [message.text];
}

// An image counts as this many tokens, whatever its size (runtime spec, section 7.3).
const tokensPerImage = 1_500;

/** The estimated tokens of one message of the conversation, with its own overhead. */
export function estimateMessageTokens(message: ModelMessage): number {
  const texts = messageTexts(message).reduce((sum, text) => sum + estimateTextTokens(text), 0);
  const images = message.role === "owner" ? (message.images?.length ?? 0) : 0;
  return tokensPerMessage + texts + images * tokensPerImage;
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
