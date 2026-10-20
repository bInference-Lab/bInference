import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type LaunchTerms, launchTermsSchema } from "../requests/intent-request.schema.js";
import type { AgentArgs } from "../values/agent-args.schema.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { plainIdSchema } from "../values/plain-id.schema.js";
import { launchDraftIdSchema } from "../views/launch-draft-push.schema.js";
import type { TurnRef } from "./chat-operations.schema.js";
import { writeFlags, type OperationTable } from "./operation.schema.js";

/** The owner's photo a launch draft takes as its picture: one image of one of the owner's messages. */
interface DraftPhoto {
  readonly message: ProtocolId<"inboxMessage">;
  /** The `tg:<file id>` the message names. */
  readonly image: string;
}

/**
 * The args of `launch/draft` (decision 0285): the agent's launch terms in its running turn, and the
 * owner's photo for a launchpad that takes a picture, none for one that takes a picture link.
 */
interface DraftArgs extends AgentArgs, TurnRef {
  readonly launch: LaunchTerms;
  readonly photo?: DraftPhoto;
}

/** What `launch/draft` answers: the draft's id, as its pushes carry it, and when it ends. */
interface DraftedLaunch {
  readonly draft: string;
  readonly expiresAt: number;
}

/** The operation the agent drafts a token launch with, which only the owner starts. */
export interface LaunchDraftOperationShapes {
  readonly "launch/draft": { readonly args: DraftArgs; readonly result: DraftedLaunch };
}

/** The launch draft operation, by name. */
export const launchDraftOperations: OperationTable<LaunchDraftOperationShapes> = {
  "launch/draft": {
    ...writeFlags,
    name: "launch/draft",
    scope: "agent",
    args: z.strictObject({
      agent: protocolIdSchema("agent"),
      session: protocolIdSchema("chatSession"),
      turn: protocolIdSchema("chatTurn"),
      launch: launchTermsSchema,
      photo: z
        .strictObject({ message: protocolIdSchema("inboxMessage"), image: plainIdSchema })
        .exactOptional(),
    }),
    result: z.object({ draft: launchDraftIdSchema, expiresAt: epochMsSchema }),
  },
};
