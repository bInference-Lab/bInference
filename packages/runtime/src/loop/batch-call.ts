import type { OwnerMessage } from "./model-message.js";
import type { NumberedCall } from "./run-tool-call.js";
import type { PreparedCall } from "./turn-ports.js";

/** A call of a batch, numbered in its turn, after the tool box checked it. */
export interface BatchCall extends NumberedCall {
  readonly prepared: PreparedCall;
}

/** How a batch ended. */
export interface BatchEnd {
  /** A tool asked the owner a question: the turn ends after the batch. */
  readonly askedOwner: boolean;
  /** Messages that joined at a merge point inside the batch; they follow its results. */
  readonly joined: readonly OwnerMessage[];
  /** A call went past the turn's tool call limit: the turn ends after the batch. */
  readonly reachedLimit: boolean;
}
