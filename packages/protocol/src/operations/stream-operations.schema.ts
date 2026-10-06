import type { LogLevel } from "@binference/core";
import { z } from "zod";
import { type PushTopic, pushTopicSchema } from "../frames/push-frame.schema.js";
import { type Empty, emptyArgsSchema, emptyResultSchema } from "../values/empty.schema.js";
import { type FileTicket, fileTicketSchema } from "../views/file-ticket.schema.js";
import { readFlags, subscribeFlags, type OperationTable } from "./operation.schema.js";

const maxUploadBytes = 5 * 1024 * 1024;

/** The args of `upload/start`: one image of at most 5 MiB. */
interface UploadArgs {
  readonly contentType: "image/png" | "image/jpeg" | "image/webp";
  readonly bytes: number;
}

/** Where a subscription to one topic starts: `fromSeq`, or the next push when absent. */
interface TopicStart {
  readonly fromSeq?: number;
}

/** The answer of `push/subscribe`. */
interface SubscribeView {
  /** Each topic's current `seq`; 0 before its first push. */
  readonly seqs: Readonly<Partial<Record<PushTopic, number>>>;
  /** Topics whose `fromSeq` is older than the engine keeps: refetch them with their list. */
  readonly resync?: readonly PushTopic[];
}

/** The upload, push and log stream operations of protocol spec section 7.9. */
export interface StreamOperationShapes {
  readonly "upload/start": { readonly args: UploadArgs; readonly result: FileTicket };
  readonly "push/subscribe": {
    readonly args: { readonly topics: Readonly<Partial<Record<PushTopic, TopicStart>>> };
    readonly result: SubscribeView;
  };
  readonly "push/unsubscribe": {
    readonly args: { readonly topics: readonly PushTopic[] };
    readonly result: Empty;
  };
  /** Log lines then arrive on the `log` topic. */
  readonly "log/follow": {
    readonly args: { readonly level?: LogLevel };
    readonly result: Empty;
  };
  readonly "log/unfollow": { readonly args: Empty; readonly result: Empty };
}

/** The upload, push and log stream operations, by name. */
export const streamOperations: OperationTable<StreamOperationShapes> = {
  "upload/start": {
    ...readFlags,
    name: "upload/start",
    scope: "chat",
    args: z.strictObject({
      contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
      bytes: z.int().min(1).max(maxUploadBytes),
    }),
    result: fileTicketSchema,
  },
  "push/subscribe": {
    ...subscribeFlags,
    name: "push/subscribe",
    scope: "read",
    args: z.strictObject({
      topics: z.record(
        pushTopicSchema,
        z.strictObject({ fromSeq: z.int().min(1).exactOptional() }),
      ),
    }),
    result: z.object({
      seqs: z.record(pushTopicSchema, z.int().nonnegative()),
      resync: z.array(pushTopicSchema).exactOptional(),
    }),
  },
  "push/unsubscribe": {
    ...subscribeFlags,
    name: "push/unsubscribe",
    scope: "read",
    args: z.strictObject({ topics: z.array(pushTopicSchema).min(1) }),
    result: emptyResultSchema,
  },
  "log/follow": {
    ...subscribeFlags,
    name: "log/follow",
    scope: "admin",
    args: z.strictObject({ level: z.enum(["debug", "info", "warn", "error"]).exactOptional() }),
    result: emptyResultSchema,
  },
  "log/unfollow": {
    ...subscribeFlags,
    name: "log/unfollow",
    scope: "admin",
    args: emptyArgsSchema,
    result: emptyResultSchema,
  },
};
