import { type Amount, amountSchema } from "@binference/chain";
import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { type AssetInfos, assetInfosSchema } from "./asset-info.schema.js";

/**
 * Where a notice's delivery to one chat surface stands (decision 0133): `queued` waits to be sent,
 * `sent` reached the chat, `unknown_after_send` may have reached it and is never sent again, and
 * `failed` was refused for good.
 */
export type NoticeDeliveryState = "queued" | "sent" | "unknown_after_send" | "failed";

/**
 * A message a notice's message takes as an argument (spec 4, section 4.3): its key and its own
 * plain values, times and amounts, and its own parts, two levels below the notice at most.
 */
export interface NoticePartView {
  readonly key: string;
  readonly parts?: Readonly<Record<string, NoticePartView>>;
  readonly values: Readonly<Record<string, string>>;
  readonly amounts?: Readonly<Record<string, Amount>>;
  readonly times?: Readonly<Record<string, number>>;
}

/**
 * One owner notice as the `notice/new` push and `notice/list` carry it: its id and time, the
 * message key and its arguments, the plain values, the times in epoch milliseconds, the amounts
 * in base units and the parts, for each surface to format, the messages that follow it on lines
 * of their own, and the agent and intent it is about.
 */
export interface NoticePushView extends NoticePartView {
  readonly id: ProtocolId<"notice">;
  readonly at: number;
  readonly agent?: ProtocolId<"agent">;
  readonly intent?: ProtocolId<"intent">;
  readonly after?: readonly NoticePartView[];
  /**
   * The info of each token its amounts name that the registry does not list, as the intent or the
   * order's card stored it at the proposal, marked unverified (decision 0199).
   */
  readonly assets?: AssetInfos;
}

/** A stored notice as `notice/list` gives it: the push's fields and each surface's delivery. */
export interface NoticeView extends NoticePushView {
  readonly delivered: Readonly<Record<string, NoticeDeliveryState>>;
}

const messageShape = {
  key: z.string().min(1),
  amounts: z.record(z.string(), amountSchema).exactOptional(),
  times: z.record(z.string(), epochMsSchema).exactOptional(),
  values: z.record(z.string(), z.string()),
};

// A part with parts of its own one level below it, whose parts take none.
const leafPartSchema: z.ZodType<NoticePartView> = z.object(messageShape);
const partSchema: z.ZodType<NoticePartView> = z.object({
  ...messageShape,
  parts: z.record(z.string(), leafPartSchema).exactOptional(),
});

const pushShape = {
  id: protocolIdSchema("notice"),
  at: epochMsSchema,
  ...messageShape,
  agent: protocolIdSchema("agent").exactOptional(),
  intent: protocolIdSchema("intent").exactOptional(),
  parts: z.record(z.string(), partSchema).exactOptional(),
  after: z.array(partSchema).exactOptional(),
  assets: assetInfosSchema.exactOptional(),
};

/** Parses the data of a `notice/new` push. */
export const noticePushViewSchema: z.ZodType<NoticePushView> = z.object(pushShape);

/** Parses one notice of `notice/list`. */
export const noticeViewSchema: z.ZodType<NoticeView> = z.object({
  ...pushShape,
  delivered: z.record(z.string(), z.enum(["queued", "sent", "unknown_after_send", "failed"])),
});
