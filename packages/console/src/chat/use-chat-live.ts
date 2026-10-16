import { type ChatPush, chatPushOf, type ProtocolId } from "@binference/protocol";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useTopic } from "../connection/use-topic";
import type { LiveLine } from "./chat-entries";
import { transcriptKey } from "./use-transcript";

/** The agent's running turn: when the page saw it start, and the answer it writes so far. */
interface RunningTurn {
  readonly turn: string;
  readonly startedAt: number;
  readonly draft?: string;
}

/** What the page heard on the agent's chat topic, and the owner's messages it sent. */
export interface ChatLive {
  readonly lines: readonly LiveLine[];
  readonly running?: RunningTurn;
  /** Adds a message the owner sent from this page, until the transcript holds it. */
  readonly sent: (line: Extract<LiveLine, { readonly kind: "owner" }>) => void;
  /** Forgets every line, as after the owner cleared the chat. */
  readonly reset: () => void;
}

type Step = (lines: readonly LiveLine[]) => readonly LiveLine[];

// The most lines the page keeps; the oldest leave first, as the transcript holds what they said.
const mostLines = 500;
type Move = (running: RunningTurn | undefined) => RunningTurn | undefined;

/** What one push changes: the running turn, and the lines it adds. */
interface PushStep {
  readonly running?: Move;
  readonly lines?: Step;
}

type MessagePush = Extract<ChatPush, { readonly kind: "chat/message" }>;

// A draft shows in the running turn; a final answer joins the lines and ends the draft.
function messageStep(push: MessagePush, id: string): PushStep {
  if (!push.final) {
    return {
      running: (running) => ({
        turn: push.turn,
        startedAt: running?.startedAt ?? Date.now(),
        draft: push.text,
      }),
    };
  }
  return {
    running: (running) =>
      running === undefined ? running : { turn: running.turn, startedAt: running.startedAt },
    lines: (lines) => [...lines, { kind: "answer", id, turn: push.turn, text: push.text }],
  };
}

function stepOf(push: ChatPush, id: string): PushStep {
  if (push.kind === "chat/turnStarted") {
    return { running: () => ({ turn: push.turn, startedAt: Date.now() }) };
  }
  if (push.kind === "chat/message") {
    return messageStep(push, id);
  }
  if (push.kind === "chat/status") {
    const { turn, statusKey, values } = push;
    const line: LiveLine = {
      kind: "status",
      id,
      turn,
      statusKey,
      ...(values === undefined ? {} : { values }),
    };
    return { lines: (lines) => [...lines, line] };
  }
  return { running: (running) => (running?.turn === push.turn ? undefined : running) };
}

/**
 * Follows the agent's chat topic while the chat is open: the running turn and the draft of its
 * answer, each final answer and status line in the order they came. A turn that starts or ends,
 * and a gap in the topic, load the transcript again.
 */
export function useChatLive(agent: ProtocolId<"agent">): ChatLive {
  const queries = useQueryClient();
  const [lines, setLines] = useState<readonly LiveLine[]>([]);
  const [running, setRunning] = useState<RunningTurn | undefined>(undefined);
  const stale = useCallback(
    async (): Promise<void> => queries.invalidateQueries({ queryKey: transcriptKey(agent) }),
    [queries, agent],
  );
  useTopic(`chat:${agent}`, {
    onPush: (frame) => {
      const push = chatPushOf(frame);
      if (push === undefined) {
        return;
      }
      const step = stepOf(push, `push ${String(frame.seq)}`);
      if (step.running !== undefined) {
        setRunning(step.running);
      }
      const { lines: add } = step;
      if (add !== undefined) {
        setLines((shown) => add(shown).slice(-mostLines));
      }
      if (push.kind === "chat/turnStarted" || push.kind === "chat/turnEnded") {
        void stale();
      }
    },
    refetch: stale,
  });
  const sent = useCallback((line: Extract<LiveLine, { readonly kind: "owner" }>) => {
    setLines((shown) => [...shown, line].slice(-mostLines));
  }, []);
  const reset = useCallback(() => {
    setLines([]);
    setRunning(undefined);
  }, []);
  return { lines, ...(running === undefined ? {} : { running }), sent, reset };
}
