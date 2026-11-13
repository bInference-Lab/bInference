import type { CallableName } from "@binference/client";
import { type OperationShapes, operations } from "@binference/protocol";
import type { CallClient } from "./call-slots.js";
import type { ReadLimit } from "./read-limit.js";

// The runtime's calls outside a turn that wake the agent or show its goal: refused before they
// ran, each goes again, so a helper's report or a goal turn is never lost to a busy engine.
const resentOutsideTurn: ReadonlySet<string> = new Set([
  "helper/ended",
  "goal/continue",
  "goal/show",
  "image/made",
  "media/made",
]);

// A turn reads the owner's images as its input, a read outside the `read` scope.
const readsOfTheTurn: ReadonlySet<string> = new Set(["inbox/readImage"]);

// A read changes nothing, so a read that never ran goes again.
function isRead(op: CallableName<OperationShapes>): boolean {
  const operation = operations[op];
  const isReadScope = operation.scope === "read" && operation.idempotency !== "key";
  return isReadScope || readsOfTheTurn.has(op);
}

/** The calls the agent's tools, each turn's context and the owner's images go through. */
export interface ToolLink {
  /** Sends each call once. */
  readonly client: CallClient;
  /** Sends again a call the engine or the client refused before it ran. */
  readonly resending: CallClient;
  /** How many reads run at once. */
  readonly reads: ReadLimit;
}

/**
 * The client the agent's tools, each turn's context and the owner's images call the engine
 * through (decision 0442): a read, an operation of the `read` scope that is no write, or
 * `inbox/readImage`, waits its turn among the link's reads, then goes through `resending`; the
 * wake-ups `helper/ended`, `goal/continue`, `image/made` and `media/made`, with the goal's line
 * `goal/show`, go through `resending` at once; every other call, a proposal among them, goes once
 * through `client`.
 */
export function createEngineToolClient(link: ToolLink): CallClient {
  return {
    async call(op, args, options) {
      if (isRead(op)) {
        return link.reads.run(async () => link.resending.call(op, args, options), options.signal);
      }
      const through = resentOutsideTurn.has(op) ? link.resending : link.client;
      return through.call(op, args, options);
    },
  };
}
