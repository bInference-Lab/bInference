import type { CardLinesView, ProtocolId, QuestionView } from "@binference/protocol";

/** A card version that waits for the owner, as the chat shows it. */
export interface OpenCard {
  readonly intent: ProtocolId<"intent">;
  readonly paper: boolean;
  readonly shown: CardLinesView;
  /** When the chat first showed this version, by its own clock. */
  readonly seenAt: number;
  /** How long the card lasts from when it opened (60 seconds). */
  readonly lifetimeMs: number;
}

/** The agent's turn that runs now: when the chat saw it start, and its answer so far. */
interface RunningTurn {
  readonly turn: string;
  readonly startedAt: number;
  readonly draft?: string;
}

/** What the chat's live area shows. */
export interface ChatState {
  /** The line the owner types. */
  readonly input: string;
  /** Keys arrive from a paste, so Enter starts a new line of the same message. */
  readonly isPasting: boolean;
  readonly running?: RunningTurn;
  /** The agent's open question. */
  readonly question?: QuestionView;
  /** The cards that wait for the owner, oldest first; the keys answer the first. */
  readonly cards: readonly OpenCard[];
  /** The client has lost its connection and is making a new one. */
  readonly isReconnecting: boolean;
}

/** The chat's state, and how a part of the chat changes it; each change draws the live area. */
export interface ChatStore {
  get(): ChatState;
  update(change: (state: ChatState) => ChatState): void;
}

// The state of a chat as it opens: nothing typed, running, asked or waiting.
const emptyChat: ChatState = {
  input: "",
  isPasting: false,
  cards: [],
  isReconnecting: false,
};

/** Creates the chat's store; `changed` runs after each update. */
export function createChatStore(changed: () => void): ChatStore {
  let state = emptyChat;
  return {
    get: () => state,
    update: (change) => {
      state = change(state);
      changed();
    },
  };
}

/** The state without its running turn. */
export function withoutRunning(state: ChatState): ChatState {
  const { running: _ended, ...rest } = state;
  return rest;
}

/** The state without its question. */
export function withoutQuestion(state: ChatState): ChatState {
  const { question: _closed, ...rest } = state;
  return rest;
}

/** The whole seconds a card has left at `now`, never more than it lasts; 0 once it expired. */
export function secondsLeft(card: OpenCard, now: number): number {
  const byEngine = card.shown.expiresAt - now;
  const byChat = card.lifetimeMs - (now - card.seenAt);
  return Math.max(0, Math.ceil(Math.min(byEngine, byChat) / 1_000));
}
