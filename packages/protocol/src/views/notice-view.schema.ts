import { type Amount, amountSchema } from "@binference/chain";
import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";

/**
 * Where a notice's delivery to one chat surface stands (decision 0133): `queued` waits to be sent,
 * `sent` reached the chat, `unknown_after_send` may have reached it and is never sent again, and
 * `failed` was refused for good.
 */
export type NoticeDeliveryState = "queued" | "sent" | "unknown_after_send" | "failed";

/**
 * One owner notice as the `notice/new` push and `notice/list` carry it: its id and time, the
 * message key and its arguments, the plain values, the times in epoch milliseconds and the amounts
 * in base units, for each surface to format, and the agent and intent it is about.
 */
export interface NoticePushView {
  readonly id: ProtocolId<"notice">;
  readonly at: number;
  readonly key: string;
  readonly agent?: ProtocolId<"agent">;
  readonly intent?: ProtocolId<"intent">;
  readonly values: Readonly<Record<string, string>>;
  readonly times?: Readonly<Record<string, number>>;
  readonly amounts?: Readonly<Record<string, Amount>>;
}

/** A stored notice as `notice/list` gives it: the push's fields and each surface's delivery. */
export interface NoticeView extends NoticePushView {
  readonly delivered: Readonly<Record<string, NoticeDeliveryState>>;
}

const pushShape = {
  id: protocolIdSchema("notice"),
  at: epochMsSchema,
  key: z.string().min(1),
  agent: protocolIdSchema("agent").exactOptional(),
  intent: protocolIdSchema("intent").exactOptional(),
  values: z.record(z.string(), z.string()),
  times: z.record(z.string(), epochMsSchema).exactOptional(),
  amounts: z.record(z.string(), amountSchema).exactOptional(),
};

/** Parses the data of a `notice/new` push. */
export const noticePushViewSchema: z.ZodType<NoticePushView> = z.object(pushShape);

/** Parses one notice of `notice/list`. */
export const noticeViewSchema: z.ZodType<NoticeView> = z.object({
  ...pushShape,
  delivered: z.record(z.string(), z.enum(["queued", "sent", "unknown_after_send", "failed"])),
});
