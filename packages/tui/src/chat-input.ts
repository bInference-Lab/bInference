import { callOptions, type ChatContext } from "./chat-context.js";
import type { ChatAction } from "./chat-keys.js";
import { failureText, saidLines } from "./chat-lines.js";
import type { ScreenLine } from "./chat-screen.js";
import type { ChatTranscript } from "./chat-transcript.js";

/** What the owner's keys reach. */
export interface ChatInputParts {
  readonly transcript: ChatTranscript;
  /** Runs one of the owner's actions after the actions before it. */
  readonly queue: (job: () => Promise<void>) => void;
  /** Ends the chat, as Ctrl+C does. */
  readonly leave: () => void;
}

const helpKeys = ["send", "stop", "clear", "card", "question", "exit"] as const;
// The commands that would attach an image, which the terminal cannot send.
const imageCommands: ReadonlySet<string> = new Set(["/image", "/images", "/photo", "/picture"]);

function dim(text: string): ScreenLine {
  return { text, tone: "dim" };
}

async function post(context: ChatContext, parts: ChatInputParts, text: string): Promise<void> {
  const you = context.words("tui.you");
  context.print(saidLines(you, text));
  try {
    const { turn } = await context.client.call(
      "chat/post",
      { agent: context.agent, text },
      callOptions(context),
    );
    parts.transcript.printed("owner", turn);
  } catch (error) {
    context.print([
      dim(context.words("tui.failed", { reason: failureText(context.words, error) })),
    ]);
  }
}

async function clear(context: ChatContext, parts: ChatInputParts): Promise<void> {
  await context.client.call("chat/clear", { agent: context.agent }, callOptions(context));
  parts.transcript.reset();
  context.print([dim(context.words("tui.cleared"))]);
}

async function stop(context: ChatContext): Promise<void> {
  if (context.store.get().running !== undefined) {
    await context.client.call("chat/stop", { agent: context.agent }, callOptions(context));
  }
}

// A line the owner sent: a command of the chat's own, or a message to the agent.
function sent(context: ChatContext, parts: ChatInputParts, line: string): void {
  const { words } = context;
  const command = line.toLowerCase();
  if (command === "/clear") {
    parts.queue(async () => clear(context, parts));
  } else if (command === "/stop") {
    parts.queue(async () => stop(context));
  } else if (command === "/help") {
    context.print(helpKeys.map((key) => dim(words(`tui.help.${key}`))));
  } else if (imageCommands.has(command)) {
    context.print([dim(words("tui.images"))]);
  } else {
    parts.queue(async () => post(context, parts, line));
  }
}

// What a key does to the line the owner types.
function edited(input: string, action: ChatAction): string {
  if (action.kind === "type") {
    return `${input}${action.text}`;
  }
  if (action.kind === "erase") {
    return Array.from(input).slice(0, -1).join("");
  }
  return action.kind === "clearLine" ? "" : input;
}

type ActionHandler = (context: ChatContext, parts: ChatInputParts, action: ChatAction) => void;

function edit(context: ChatContext, parts: ChatInputParts, action: ChatAction): void {
  context.store.update((state) => ({ ...state, input: edited(state.input, action) }));
}

function paste(context: ChatContext, parts: ChatInputParts, action: ChatAction): void {
  context.store.update((state) => ({ ...state, isPasting: action.kind === "pasteStart" }));
}

function send(context: ChatContext, parts: ChatInputParts): void {
  const line = context.store.get().input.trim();
  context.store.update((state) => ({ ...state, input: "" }));
  if (line !== "") {
    sent(context, parts, line);
  }
}

const handlers: Readonly<Record<ChatAction["kind"], ActionHandler>> = {
  type: edit,
  erase: edit,
  clearLine: edit,
  pasteStart: paste,
  pasteEnd: paste,
  send,
  stop: (context, parts) => parts.queue(async () => stop(context)),
  confirm: () => undefined,
  cancel: () => undefined,
  choose: () => undefined,
  leave: (context, parts) => parts.leave(),
  ignore: () => undefined,
};

/**
 * Acts on one key: edits the typed line, sends it (a line of its own, `/clear`, `/stop`, `/help`
 * or an image command, is the chat's own), stops the agent's answer, follows a paste, or leaves.
 */
export function onAction(context: ChatContext, parts: ChatInputParts, action: ChatAction): void {
  handlers[action.kind](context, parts, action);
}
