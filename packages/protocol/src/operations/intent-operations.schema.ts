import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type IntentRequest, intentRequestSchema } from "../requests/intent-request.schema.js";
import { type Page, type PageArgs, pageArgsShape, pageSchema } from "../values/page.schema.js";
import { type IntentKind, intentKindSchema } from "../views/intent-kind.schema.js";
import { type IntentState, intentStateSchema } from "../views/intent-state.schema.js";
import { type IntentView, intentViewSchema } from "../views/intent-view.schema.js";
import { readFlags, writeFlags, type OperationTable } from "./operation.schema.js";

/** The args of an operation on one intent. */
interface IntentArgs {
  readonly intent: ProtocolId<"intent">;
}

/** The args of `intent/list`: a page of intents, filtered by agent, state and kind. */
interface ListIntentsArgs extends PageArgs {
  readonly agent?: ProtocolId<"agent">;
  readonly state?: IntentState;
  readonly kind?: IntentKind;
}

/** The args of `intent/deny`: the card the owner answered. */
interface DenyArgs extends IntentArgs {
  readonly card: ProtocolId<"card">;
}

/** The args of `intent/confirm`: the card and the version the owner saw. */
interface ConfirmArgs extends DenyArgs {
  readonly cardVersion: number;
}

/** The intent operations of protocol spec section 7.4. */
export interface IntentOperationShapes {
  readonly "intent/propose": { readonly args: IntentRequest; readonly result: IntentView };
  readonly "intent/get": { readonly args: IntentArgs; readonly result: IntentView };
  readonly "intent/list": { readonly args: ListIntentsArgs; readonly result: Page<IntentView> };
  readonly "intent/confirm": { readonly args: ConfirmArgs; readonly result: IntentView };
  readonly "intent/deny": { readonly args: DenyArgs; readonly result: IntentView };
  readonly "intent/cancel": { readonly args: IntentArgs; readonly result: IntentView };
}

const intent = protocolIdSchema("intent");
const card = protocolIdSchema("card");
const intentArgs = z.strictObject({ intent });

/** The intent operations, by name. */
export const intentOperations: OperationTable<IntentOperationShapes> = {
  "intent/propose": {
    ...writeFlags,
    name: "intent/propose",
    scope: "propose",
    args: intentRequestSchema,
    result: intentViewSchema,
  },
  "intent/get": {
    ...readFlags,
    name: "intent/get",
    scope: "read",
    args: intentArgs,
    result: intentViewSchema,
  },
  "intent/list": {
    ...readFlags,
    name: "intent/list",
    scope: "read",
    args: z.strictObject({
      ...pageArgsShape,
      agent: protocolIdSchema("agent").exactOptional(),
      state: intentStateSchema.exactOptional(),
      kind: intentKindSchema.exactOptional(),
    }),
    result: pageSchema(intentViewSchema),
  },
  "intent/confirm": {
    ...writeFlags,
    name: "intent/confirm",
    scope: "confirm",
    args: z.strictObject({ intent, card, cardVersion: z.int().min(1) }),
    result: intentViewSchema,
  },
  "intent/deny": {
    ...writeFlags,
    name: "intent/deny",
    scope: "confirm",
    args: z.strictObject({ intent, card }),
    result: intentViewSchema,
  },
  "intent/cancel": {
    ...writeFlags,
    name: "intent/cancel",
    scope: "confirm",
    scopeCase: { scope: "propose", when: "ownIntent" },
    args: intentArgs,
    result: intentViewSchema,
  },
};
