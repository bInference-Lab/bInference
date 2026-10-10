import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { type Notice, noticeSchema } from "../pushes/notice-push.js";
import { epochMsSchema, pageLimitSchema, rowNumberSchema } from "../records/record-fields.js";

/** A chat surface the engine sends notices to through the outbox. */
export type NoticeSurface = "telegram";

/** Every {@link NoticeSurface}. */
export const noticeSurfaces: readonly NoticeSurface[] = ["telegram"];

/**
 * Where one notice's delivery to a surface stands (decision 0133). `unknown_after_send` is set
 * before the surface is called, so a delivery whose call may have reached the surface is never
 * sent again; `failed` is one the surface refused for good.
 */
export type DeliveryState = "queued" | "sent" | "unknown_after_send" | "failed";

/** How urgent a notice is, from the status icon its message opens with (decision 0133). */
export type NoticeLevel = "info" | "warning" | "critical";

/** Each surface's delivery state of one notice. */
export type NoticeDeliveries = Readonly<Partial<Record<NoticeSurface, DeliveryState>>>;

/**
 * One notice as the store keeps it (database spec, section 2.7): its id and time, the notice,
 * its kind (the name after `notice.`), its level, and where its delivery to each surface stands.
 */
export interface NoticeRecord {
  readonly id: Id<"ntc">;
  readonly atMs: number;
  readonly notice: Notice;
  readonly kind: string;
  readonly level: NoticeLevel;
  readonly delivered: NoticeDeliveries;
}

const surfaceSchema = z.enum(["telegram"]);
const deliveryStateSchema = z.enum(["queued", "sent", "unknown_after_send", "failed"]);

// Each surface's delivery state of a notice.
const deliveriesSchema: z.ZodType<NoticeDeliveries> = z.partialRecord(
  surfaceSchema,
  deliveryStateSchema,
);

/** Parses a stored notice. */
export const noticeRecordSchema: z.ZodType<NoticeRecord> = z.strictObject({
  id: idSchema("ntc"),
  atMs: epochMsSchema,
  notice: noticeSchema,
  kind: z.string().min(1),
  level: z.enum(["info", "warning", "critical"]),
  delivered: deliveriesSchema,
});

/** Which notices to list: those recorded after the notice `after` (from the first when absent). */
export interface NoticePage {
  readonly after?: Id<"ntc">;
  readonly limit: number;
}

/** Parses a notice page. */
export const noticePageSchema: z.ZodType<NoticePage> = z.strictObject({
  after: idSchema("ntc").exactOptional(),
  limit: pageLimitSchema,
});

/**
 * One notice's delivery to one surface, as the outbox holds it: its row number, which counts in
 * the order the notices were recorded, how many sends were tried, and when the next may start.
 */
export interface NoticeDelivery {
  readonly id: number;
  readonly surface: NoticeSurface;
  readonly state: DeliveryState;
  readonly attempts: number;
  readonly nextAtMs: number;
  readonly record: NoticeRecord;
}

/** Parses a notice delivery. */
export const noticeDeliverySchema: z.ZodType<NoticeDelivery> = z.strictObject({
  id: rowNumberSchema,
  surface: surfaceSchema,
  state: deliveryStateSchema,
  attempts: z.int().nonnegative(),
  nextAtMs: epochMsSchema,
  record: noticeRecordSchema,
});

/** The deliveries waiting on one surface, oldest first, at most `limit`. */
export interface QueuedQuery {
  readonly surface: NoticeSurface;
  readonly limit: number;
}

/** Parses a queued query. */
export const queuedQuerySchema: z.ZodType<QueuedQuery> = z.strictObject({
  surface: surfaceSchema,
  limit: pageLimitSchema,
});

/**
 * A move of one delivery from the state the mover read to the next (decision 0133):
 * `queued` to `unknown_after_send` before a send, which counts an attempt; `unknown_after_send` to
 * `sent` once the surface took it; `unknown_after_send` back to `queued` at `nextAtMs` when the
 * surface refused it and sent nothing; either to `failed`, which the surface will refuse again.
 */
export type DeliveryMove =
  | { readonly id: number; readonly from: "queued"; readonly to: "unknown_after_send" }
  | {
      readonly id: number;
      readonly from: "unknown_after_send";
      readonly to: "sent";
      readonly atMs: number;
    }
  | {
      readonly id: number;
      readonly from: "unknown_after_send";
      readonly to: "queued";
      readonly nextAtMs: number;
    }
  | {
      readonly id: number;
      readonly from: "queued" | "unknown_after_send";
      readonly to: "failed";
    };

const moveId = { id: rowNumberSchema };

/** Parses a delivery move. */
export const deliveryMoveSchema: z.ZodType<DeliveryMove> = z.discriminatedUnion("to", [
  z.strictObject({ ...moveId, from: z.literal("queued"), to: z.literal("unknown_after_send") }),
  z.strictObject({
    ...moveId,
    from: z.literal("unknown_after_send"),
    to: z.literal("sent"),
    atMs: epochMsSchema,
  }),
  z.strictObject({
    ...moveId,
    from: z.literal("unknown_after_send"),
    to: z.literal("queued"),
    nextAtMs: epochMsSchema,
  }),
  z.strictObject({
    ...moveId,
    from: z.enum(["queued", "unknown_after_send"]),
    to: z.literal("failed"),
  }),
]);
