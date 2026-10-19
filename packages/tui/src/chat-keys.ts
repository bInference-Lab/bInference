/** A key as Node's `readline` reads it from the terminal in raw mode. */
export interface PressedKey {
  readonly name?: string | undefined;
  readonly ctrl?: boolean | undefined;
  readonly meta?: boolean | undefined;
}

/** What a key asks the chat to do. */
export type ChatAction =
  | { readonly kind: "leave" | "send" | "stop" | "confirm" | "cancel" | "erase" | "clearLine" }
  | { readonly kind: "pasteStart" | "pasteEnd" | "ignore" }
  | { readonly kind: "type"; readonly text: string }
  | { readonly kind: "choose"; readonly place: number };

/** What a key's meaning depends on. */
export interface KeyContext {
  readonly input: string;
  readonly isPasting: boolean;
  /** How many choices the agent's open question has; 0 with no question. */
  readonly choices: number;
}

// Ctrl and a letter: leave, answer the first card, or clear the typed line. Ordinary typing
// never makes these keys, so a message being written never answers a card.
const ctrlActions: Readonly<Record<string, ChatAction>> = {
  c: { kind: "leave" },
  y: { kind: "confirm" },
  n: { kind: "cancel" },
  u: { kind: "clearLine" },
};

const namedActions: Readonly<Record<string, ChatAction>> = {
  escape: { kind: "stop" },
  backspace: { kind: "erase" },
  "paste-start": { kind: "pasteStart" },
  "paste-end": { kind: "pasteEnd" },
};
const ignored: ChatAction = { kind: "ignore" };

// A character the owner typed; a control character or an escape sequence is no text.
const typedText = /^[^\p{Cc}]+$/u;

function enterAction(context: KeyContext): ChatAction {
  return context.isPasting ? { kind: "type", text: "\n" } : { kind: "send" };
}

function textAction(text: string | undefined, context: KeyContext): ChatAction {
  if (text === undefined || !typedText.test(text)) {
    return ignored;
  }
  const place = Number(text) - 1;
  const isChoice = context.input === "" && /^[1-9]$/.test(text) && place < context.choices;
  return isChoice ? { kind: "choose", place } : { kind: "type", text };
}

function ctrlAction(key: PressedKey, context: KeyContext): ChatAction {
  if (key.name === "d") {
    return context.input === "" ? { kind: "leave" } : ignored;
  }
  return ctrlActions[key.name ?? ""] ?? ignored;
}

/**
 * What a key does in the chat: Enter sends (inside a paste it starts a new line), Esc stops the
 * agent's answer, Ctrl+Y confirms and Ctrl+N cancels the first waiting card, a number key on an
 * empty line answers the open question, Ctrl+U clears the line, Ctrl+C (or Ctrl+D on an empty
 * line) leaves; any other printable text is typed.
 */
export function keyAction(
  text: string | undefined,
  key: PressedKey,
  context: KeyContext,
): ChatAction {
  if (key.ctrl === true) {
    return ctrlAction(key, context);
  }
  if (key.name === "return" || key.name === "enter") {
    return enterAction(context);
  }
  const named = namedActions[key.name ?? ""];
  if (named !== undefined) {
    return named;
  }
  return key.meta === true ? ignored : textAction(text, context);
}
