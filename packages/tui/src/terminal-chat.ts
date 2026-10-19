import { emitKeypressEvents } from "node:readline";
import type { Clock } from "@binference/core";
import type { Formatter } from "@binference/i18n";
import type { ProtocolId } from "@binference/protocol";
import { type ChatClient, type ChatContext, createJobQueue } from "./chat-context.js";
import { followChat } from "./chat-feed.js";
import { type ChatInputParts, onAction } from "./chat-input.js";
import { keyAction, type PressedKey } from "./chat-keys.js";
import { agentNameText, failureText, wordsOf } from "./chat-lines.js";
import { type ChatScreen, createChatScreen } from "./chat-screen.js";
import { createChatStore } from "./chat-state.js";
import type { ChatTerminal } from "./chat-terminal.js";
import { createChatTranscript } from "./chat-transcript.js";
import { liveRows } from "./live-rows.js";

/** What terminal chat runs with. */
export interface TerminalChatOptions {
  /** A client signed in with the `chat` and `confirm` scopes; the caller closes it. */
  readonly client: ChatClient;
  readonly agent: { readonly id: ProtocolId<"agent">; readonly name: string };
  /** The owner's formatter: every word in the owner's language. */
  readonly formatter: Formatter;
  readonly terminal: ChatTerminal;
  readonly clock: Clock;
  /** Aborts when a stop signal arrives; the chat closes as on Ctrl+C. */
  readonly signal: AbortSignal;
}

/** How the chat ended: the owner left, or the engine stopped answering for good. */
export type ChatEnd = "left" | "lost";

// Bracketed paste: the terminal marks a paste, so its new lines stay in one message.
const pasteOn = "\u001b[?2004h";
const pasteOff = "\u001b[?2004l";

/** One chat: its context, its screen, and what ends it. */
interface Session {
  readonly context: ChatContext;
  readonly screen: ChatScreen;
  readonly redraw: () => void;
  readonly ended: Promise<ChatEnd>;
  readonly end: (how: ChatEnd) => void;
}

function openSession(options: TerminalChatOptions, signal: AbortSignal): Session {
  const { formatter, terminal, clock } = options;
  const screen = createChatScreen(terminal);
  const agentName = agentNameText(options.agent.name);
  const words = wordsOf(formatter);
  const ending: { end: (how: ChatEnd) => void } = { end: () => undefined };
  const ended = new Promise<ChatEnd>((resolve) => {
    ending.end = resolve;
  });
  const draw = { redraw: (): void => undefined };
  const store = createChatStore(() => draw.redraw());
  draw.redraw = () => {
    const { columns } = terminal.size();
    const live = { formatter, words, agentName, now: clock.now(), columns };
    screen.show(liveRows(store.get(), live));
  };
  const print = (lines: Parameters<ChatScreen["print"]>[0]): void => screen.print(lines);
  const context = { client: options.client, agent: options.agent.id, agentName, formatter, words };
  return {
    context: { ...context, clock, store, print, signal },
    screen,
    redraw: () => draw.redraw(),
    ended,
    end: (how) => ending.end(how),
  };
}

// Subscribes the agent's chat; answers the parts the keys reach and how to unsubscribe.
function follow(session: Session, report: (error: ErrorOptions["cause"]) => void) {
  const { context } = session;
  const feed = createJobQueue(report);
  const transcript = createChatTranscript(context, context.words("tui.you"));
  const unsubscribe = [followChat(context, { transcript, queue: feed })];
  const parts: ChatInputParts = {
    transcript,
    queue: createJobQueue(report),
    leave: () => session.end("left"),
  };
  return { parts, unsubscribe: () => unsubscribe.forEach((stop) => stop()) };
}

// Reads the owner's keys in raw mode, with bracketed paste on; answers how to give them back.
function takeKeys(terminal: ChatTerminal, session: Session, parts: ChatInputParts): () => void {
  const { context } = session;
  const onKey = (text: string | undefined, key: PressedKey | undefined): void => {
    const { input, isPasting, question } = context.store.get();
    const choices = question?.choices.length ?? 0;
    onAction(context, parts, keyAction(text, key ?? {}, { input, isPasting, choices }));
  };
  emitKeypressEvents(terminal.input);
  terminal.enterRawMode();
  terminal.output.write(pasteOn);
  terminal.input.on("keypress", onKey);
  terminal.input.resume();
  const stopResize = terminal.onResize(session.redraw);
  return () => {
    stopResize();
    terminal.input.off("keypress", onKey);
    terminal.input.pause();
    terminal.output.write(pasteOff);
    terminal.leaveRawMode();
  };
}

// Each second: the link's state, the running turn's time and each card's time left.
async function tick(options: TerminalChatOptions, session: Session): Promise<void> {
  const { signal, store } = session.context;
  while (!signal.aborted) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one tick after the other
    await options.clock.sleep(1_000, signal).catch(() => undefined);
    const { state } = options.client.status();
    if (state === "closed") {
      session.end("lost");
      return;
    }
    const isReconnecting = state !== "ready";
    store.update((now) =>
      now.isReconnecting === isReconnecting ? now : { ...now, isReconnecting },
    );
  }
}

/**
 * Runs terminal chat with one agent until the owner leaves (Ctrl+C, or Ctrl+D on an empty line),
 * a stop signal arrives, or the engine stops answering for good. It prints the newest messages of
 * the agent's session, then each answer and status line as it comes, and keeps a live area at the
 * bottom: the running turn and the line the owner types. On the way out it unsubscribes every topic,
 * gives the terminal back as it found it and stops reading keys; the caller closes the client.
 */
export async function runTerminalChat(options: TerminalChatOptions): Promise<ChatEnd> {
  const lifetime = new AbortController();
  const session = openSession(options, lifetime.signal);
  const { words } = session.context;
  const followed = follow(session, (error) => {
    if (!lifetime.signal.aborted) {
      session.context.print([{ text: failureText(words, error), tone: "dim" }]);
    }
  });
  // Raw mode first: a key pressed once the first line shows never echoes.
  const giveBack = takeKeys(options.terminal, session, followed.parts);
  session.screen.print([
    { text: words("tui.intro", { agent: session.context.agentName }), tone: "bold" },
    { text: words("tui.images"), tone: "dim" },
  ]);
  const onStop = (): void => session.end("left");
  options.signal.addEventListener("abort", onStop, { once: true });
  const ticking = tick(options, session);
  session.redraw();
  const how = options.signal.aborted ? "left" : await session.ended;
  lifetime.abort();
  options.signal.removeEventListener("abort", onStop);
  followed.unsubscribe();
  giveBack();
  await ticking;
  session.screen.close();
  session.screen.print([{ text: words(how === "left" ? "tui.closed" : "tui.lost"), tone: "dim" }]);
  return how;
}
