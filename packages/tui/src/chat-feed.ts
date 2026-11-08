import { chartTextLines } from "@binference/chart";
import { displayOutsideText } from "@binference/i18n";
import {
  type ChatPush,
  chatPushOf,
  credentialPushes,
  type PushFrame,
  questionPushOf,
} from "@binference/protocol";
import type { AgentQuestion } from "./agent-question.js";
import type { ChatContext } from "./chat-context.js";
import { agentSaidLines, statusLine } from "./chat-lines.js";
import type { ScreenLine } from "./chat-screen.js";
import { type ChatState, withoutRunning } from "./chat-state.js";
import type { ChatTranscript } from "./chat-transcript.js";
import type { CredentialEntry } from "./credential-entry.js";
import { depositLines } from "./deposit-lines.js";

/** The parts the agent's chat topic feeds. */
export interface ChatFeedParts {
  readonly transcript: ChatTranscript;
  readonly question: AgentQuestion;
  readonly credential: CredentialEntry;
  /** Runs a job after the jobs before it, so the chat prints in the order the pushes came. */
  readonly queue: (job: () => Promise<void>) => void;
}

function drafted(
  state: ChatState,
  push: Extract<ChatPush, { readonly kind: "chat/message" }>,
  now: number,
): ChatState {
  const startedAt = state.running?.turn === push.turn ? state.running.startedAt : now;
  return { ...state, running: { turn: push.turn, startedAt, draft: push.text } };
}

// A final answer ends the answer so far; the turn runs on until it ends.
function answered(state: ChatState): ChatState {
  const { running } = state;
  return running === undefined
    ? state
    : { ...state, running: { turn: running.turn, startedAt: running.startedAt } };
}

function ended(state: ChatState, turn: string): ChatState {
  return state.running?.turn === turn ? withoutRunning(state) : state;
}

// Text from outside, made safe to print whole.
function shown(text: string): string {
  return displayOutsideText(text, Number.POSITIVE_INFINITY);
}

type ShownPush = Extract<
  ChatPush,
  { readonly kind: "chat/chart" | "chat/images" | "chat/files" | "chat/media" }
>;

const shownKinds: ReadonlySet<string> = new Set([
  "chat/chart",
  "chat/images",
  "chat/files",
  "chat/media",
]);

function isShownPush(push: ChatPush): push is ShownPush {
  return shownKinds.has(push.kind);
}

// What a tool showed, as the terminal prints it: a chart's text, its title in bold (decision 0387),
// or where each image, file, video or speech the agent made, showed or sent is, since the
// terminal draws and plays none of them (decision 0405).
function shownLines(context: ChatContext, push: ShownPush): readonly ScreenLine[] {
  if (push.kind === "chat/media") {
    const key = push.media.kind === "video" ? "tui.media.video" : "tui.media.voice";
    return [
      { text: context.words(key, { agent: context.agentName }), tone: "bold" },
      { text: shown(push.media.path) },
    ];
  }
  if (push.kind === "chat/chart") {
    return chartTextLines(push.chart).map((line, index): ScreenLine =>
      index === 0 ? { text: shown(line), tone: "bold" } : { text: shown(line) },
    );
  }
  if (push.kind === "chat/files") {
    const count = push.files.length;
    return [
      { text: context.words("tui.files.sent", { agent: context.agentName, count }), tone: "bold" },
      ...push.files.map((sent): ScreenLine => ({ text: shown(sent.path) })),
    ];
  }
  const count = push.images.length;
  return [
    { text: context.words("tui.images.made", { agent: context.agentName, count }), tone: "bold" },
    ...push.images.map((made): ScreenLine => ({ text: shown(made.path) })),
  ];
}

// A message of the agent: the answer so far into the live area, or the final answer printed.
function messaged(
  context: ChatContext,
  feed: { readonly parts: ChatFeedParts; readonly print: ChatContext["print"] },
  push: Extract<ChatPush, { readonly kind: "chat/message" }>,
): void {
  const { store, clock } = context;
  if (!push.final) {
    store.update((state) => drafted(state, push, clock.now()));
    return;
  }
  feed.parts.transcript.printed("agent", push.turn);
  feed.print(agentSaidLines(context.agentName, push.text));
  store.update(answered);
}

// A chat push: the running turn and its answer so far, a final answer, a status line, its end.
// What it prints waits for the jobs before it, such as a read of the transcript.
function onChatPush(context: ChatContext, parts: ChatFeedParts, push: ChatPush): void {
  const { store, clock } = context;
  const print = (lines: Parameters<ChatContext["print"]>[0]): void => {
    parts.queue(async () => {
      context.print(lines);
      return Promise.resolve();
    });
  };
  if (isShownPush(push)) {
    print(shownLines(context, push));
    return;
  }
  switch (push.kind) {
    case "chat/turnStarted":
      store.update((state) => ({ ...state, running: { turn: push.turn, startedAt: clock.now() } }));
      parts.queue(async () => parts.transcript.catchUp());
      return;
    case "chat/message":
      messaged(context, { parts, print }, push);
      return;
    case "chat/status":
      print([statusLine(context.formatter, push.statusKey, push.values)]);
      return;
    // The live area shows the answer so far; a progress line and the model's reasoning print
    // nothing.
    case "chat/progress":
    case "chat/reasoning":
      return;
    case "chat/deposit":
      print(depositLines(context.formatter, push));
      return;
    case "chat/turnEnded":
      store.update((state) => ended(state, push.turn));
      return;
  }
}

/**
 * Follows the agent's chat topic: the running turn and its answer so far in the live area, each
 * final answer and status line printed as it comes, the agent's question, and its credential
 * request, which opens the masked entry. A turn that starts,
 * and a gap in the topic, read the transcript on, so the owner's messages from other surfaces
 * show too. Answers how to stop following.
 */
export function followChat(context: ChatContext, parts: ChatFeedParts): () => void {
  return context.client.subscribe(`chat:${context.agent}`, {
    onPush: (push: PushFrame) => {
      const chat = chatPushOf(push);
      if (chat !== undefined) {
        onChatPush(context, parts, chat);
        return;
      }
      const credential = credentialPushes.credentialPushOf(push);
      if (credential?.kind === "chat/credentialRequestClosed") {
        parts.credential.closed(credential);
      }
      if (credential !== undefined) {
        parts.queue(async () => parts.credential.reload());
        return;
      }
      const question = questionPushOf(push);
      if (question?.kind === "chat/questionClosed") {
        parts.question.closed(question);
      }
      if (question !== undefined) {
        parts.queue(async () => parts.question.reload());
      }
    },
    refetch: async () => {
      parts.queue(async () => parts.transcript.catchUp());
      parts.queue(async () => parts.question.reload());
      parts.queue(async () => parts.credential.reload());
      return Promise.resolve();
    },
  });
}
