import type { Id } from "@binference/core";
import type { InboxMessageView, WorkspaceFile, ImageContentType } from "@binference/protocol";
import type { TurnOutcome } from "@binference/store";
import type { TurnRefusal } from "../loop/turn-records.js";

// The values the engine's side of chat takes and gives (see ports.ts).

/** One page of the agent inbox's untaken messages, oldest first. */
export interface InboxPage {
  readonly items: readonly InboxMessageView[];
  /** The cursor of the next page, when there is one. */
  readonly next?: string;
}

/** What the runtime does with the `inbox` topic's pushes. */
export interface InboxWatch {
  /** Each message pushed, in order. */
  readonly onMessage: (message: InboxMessageView) => void;
  /** Reads every untaken message again: when the watch starts, and after a gap or a reconnect. */
  readonly refetch: (signal: AbortSignal) => Promise<void>;
}

/** One turn of an agent, as the engine names it. */
export interface EngineTurn {
  readonly agent: Id<"agt">;
  readonly turn: Id<"trn">;
}

/** `turn/start`: the turn, its session, the messages it takes, and its outside-content mark. */
export interface EngineTurnStart extends EngineTurn {
  readonly session: Id<"ses">;
  readonly messages: readonly Id<"msg">[];
  readonly outsideContent: boolean;
}

/** How the engine answered `turn/start`. */
export type TurnStartAnswer =
  | { readonly started: true; readonly budgetLeftMicros: bigint }
  | {
      readonly started: false;
      /** Why the engine refused the turn for its agent's state. */
      readonly refusal: Exclude<TurnRefusal, "unavailable">;
      /** When a spent budget resumes, when the engine said. */
      readonly resumesAt?: number;
    };

/** `turn/say`: the agent's text of a turn, final or a draft edited in place. */
export interface EngineSay extends EngineTurn {
  readonly session: Id<"ses">;
  readonly text: string;
  readonly final: boolean;
}

/** `turn/status`: a status line of spec 4 and its values. */
export interface EngineStatus extends EngineTurn {
  readonly statusKey: string;
  readonly values?: Readonly<Record<string, number>>;
}

/** `usage/record`: one model call attempt's tokens and cost, under the record's own key. */
export interface EngineUsage extends EngineTurn {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  readonly usdMicros: bigint;
  readonly key: string;
}

/** How the engine answered a usage record: what is left, and when a spent budget resumes. */
export interface RecordedUsage {
  readonly budgetLeftMicros: bigint;
  /** The owner's next midnight, once nothing is left, when the engine said. */
  readonly resumesAt?: number;
}

/** `turn/end`: how the turn ended. */
export interface EngineTurnEnd extends EngineTurn {
  readonly outcome: TurnOutcome;
}

/** One of an agent's workspace files. */
export interface WorkspacePlace {
  readonly agent: Id<"agt">;
  readonly file: WorkspaceFile;
}

/** Why an image of the owner's message cannot be read (decision 0227). */
export type ImageReadRefusal = "not_found" | "too_large" | "format" | "unreadable";

/** One image the owner sent, whole, as the runtime holds it for the turn that takes it. */
export interface HeldOwnerImage {
  readonly contentType: ImageContentType;
  /** Its bytes in base64. */
  readonly data: string;
  /** Its size in bytes. */
  readonly bytes: number;
}

/** An image of one of an agent's messages: the upload id or `tg:<file_id>` the message names. */
export interface ImagePlace {
  readonly agent: Id<"agt">;
  readonly message: Id<"msg">;
  readonly image: string;
}
