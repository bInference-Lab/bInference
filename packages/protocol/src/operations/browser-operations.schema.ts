import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type BrowserRequest, browserRequestSchema } from "../requests/browser-request.schema.js";
import { type BrowserView, browserViewSchema } from "../views/browser-view.schema.js";
import { type OperationTable, readFlags } from "./operation.schema.js";

/** The args of `browser/run`: one call of the agent's browser. */
interface BrowserRunArgs {
  readonly agent: ProtocolId<"agent">;
  readonly request: BrowserRequest;
}

/**
 * The operation the agent drives its browser with (decision 0401). It takes no idempotency key: a
 * kept answer would store what a page showed, which never leaves the engine's memory.
 */
export interface BrowserOperationShapes {
  readonly "browser/run": { readonly args: BrowserRunArgs; readonly result: BrowserView };
}

/** The browser operations, by name. */
export const browserOperations: OperationTable<BrowserOperationShapes> = {
  "browser/run": {
    ...readFlags,
    name: "browser/run",
    scope: "agent",
    args: z.strictObject({ agent: protocolIdSchema("agent"), request: browserRequestSchema }),
    result: browserViewSchema,
  },
};
