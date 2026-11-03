import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type LaunchTerms, launchTermsSchema } from "../requests/intent-request.schema.js";
import type { AgentArgs } from "../values/agent-args.schema.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { plainIdSchema } from "../values/plain-id.schema.js";
import { type AssetInfos, assetInfosSchema } from "../views/asset-info.schema.js";
import { type CardLineView, cardLineViewSchema } from "../views/card-lines.schema.js";
import { launchDraftIdSchema } from "../views/launch-draft-push.schema.js";
import type { TurnRef } from "./chat-operations.schema.js";
import {
  type ImagePart,
  imageByteCountSchema,
  imagePartSchema,
} from "./image-operations.schema.js";
import { readFlags, writeFlags, type OperationTable } from "./operation.schema.js";

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

/**
 * The agent's open launch draft as a surface without Start shows it (decision 0345): its id, when
 * it ends, the lines Telegram's message shows between its header and footer with the assets they
 * name, and the size of the owner's photo it holds, absent for a picture link.
 */
export interface LaunchDraftView extends DraftedLaunch {
  readonly lines: readonly CardLineView[];
  readonly assets: AssetInfos;
  readonly picture?: { readonly bytes: number };
}

/** What `launch/openDraft` answers: the agent's open draft, or none. */
interface OpenDraft {
  readonly draft?: LaunchDraftView;
}

/** The args of `launch/draftPicture`: the draft's photo, from `offset`. */
interface DraftPictureArgs extends AgentArgs {
  readonly draft: string;
  /** Where this part starts, in bytes; 0 when absent. */
  readonly offset?: number;
}

/** The operations the agent drafts a token launch with, which only the owner starts, and reads. */
export interface LaunchDraftOperationShapes {
  readonly "launch/draft": { readonly args: DraftArgs; readonly result: DraftedLaunch };
  readonly "launch/openDraft": { readonly args: AgentArgs; readonly result: OpenDraft };
  readonly "launch/draftPicture": { readonly args: DraftPictureArgs; readonly result: ImagePart };
}

const draftViewSchema: z.ZodType<LaunchDraftView> = z.object({
  draft: launchDraftIdSchema,
  expiresAt: epochMsSchema,
  lines: z.array(cardLineViewSchema).max(200),
  assets: assetInfosSchema,
  picture: z.object({ bytes: imageByteCountSchema }).exactOptional(),
});

/** The launch draft operations, by name. */
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
  "launch/openDraft": {
    ...readFlags,
    name: "launch/openDraft",
    scope: "read",
    args: z.strictObject({ agent: protocolIdSchema("agent") }),
    result: z.object({ draft: draftViewSchema.exactOptional() }),
  },
  "launch/draftPicture": {
    ...readFlags,
    name: "launch/draftPicture",
    scope: "chat",
    args: z.strictObject({
      agent: protocolIdSchema("agent"),
      draft: launchDraftIdSchema,
      offset: imageByteCountSchema.exactOptional(),
    }),
    result: imagePartSchema,
  },
};
