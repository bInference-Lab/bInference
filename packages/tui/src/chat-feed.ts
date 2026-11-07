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
import { credentialLines } from "./credential-lines.js";
import { depositLines } from "./deposit-lines.js";

/** The parts the agent's chat topic feeds. */
export interface ChatFeedParts {
  readonly transcript: ChatTranscript;
  readonly question: AgentQuestion;
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
  switch (push.kind) {
    case "chat/turnStarted":
      store.update((state) => ({ ...state, running: { turn: push.turn, startedAt: clock.now() } }));
      parts.queue(async () => parts.transcript.catchUp());
      return;
    case "chat/message":
      if (!push.final) {
        store.update((state) => drafted(state, push, clock.now()));
        return;
      }
      parts.transcript.printed("agent", push.turn);
      print(agentSaidLines(context.agentName, push.text));
      store.update(answered);
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
    // The terminal draws no chart, so it prints the chart's text (decision 0387).
    case "chat/chart":
      print(
        chartTextLines(push.chart).map((line, index): ScreenLine => {
          const text = displayOutsideText(line, Number.POSITIVE_INFINITY);
          return index === 0 ? { text, tone: "bold" } : { text };
        }),
      );
      return;
    case "chat/turnEnded":
      store.update((state) => ended(state, push.turn));
      return;
  }
}

/**
 * Follows the agent's chat topic: the running turn and its answer so far in the live area, each
 * final answer and status line printed as it comes, and the agent's question. A turn that starts,
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
      if (credential?.kind === "chat/credentialRequest") {
        const lines = credentialLines(context.formatter, {
          request: credential.request,
          agentName: context.agentName,
        });
        parts.queue(async () => {
          context.print(lines);
          return Promise.resolve();
        });
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
      return Promise.resolve();
    },
  });
}
