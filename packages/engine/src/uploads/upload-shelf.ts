import { type Clock, err, ok, type Random, type Result } from "@binference/core";
import { type ImageContentType, maxImageBytes } from "@binference/protocol";
import { imageTypeOf } from "../chat/image-type.js";
import type { OwnerImageSource } from "../chat/ports.js";

/** What `upload/start` names: the image's format and its size. */
export interface UploadPlan {
  readonly contentType: ImageContentType;
  readonly bytes: number;
}

/** Who asked for a ticket: the id of the credential the caller signed in with, such as `tg:<id>`. */
export type UploadHolder = string;

/** A single-use ticket for one upload, and when it stops working. */
export interface UploadTicket {
  readonly ticket: string;
  readonly expiresAt: number;
}

/**
 * Why `POST /upload/:ticket` took nothing: no such ticket, or a used or expired one; a body over
 * 5 MiB or longer than planned; a body of another size than planned; or one whose first bytes are
 * not the planned format.
 */
export type UploadRefusal = "ticket" | "too_large" | "length" | "format";

/**
 * The owner's uploads, in engine memory only (decision 0227): a ticket for each, single-use and
 * valid 2 minutes, at most 64 open at once; each upload kept 1 hour, at most 16 at once. Past
 * either limit the oldest is dropped first. It reads uploads as the owner's images by their ids.
 */
export interface UploadShelf extends OwnerImageSource {
  /** A ticket for one upload of this plan, held for the credential that asked for it. */
  ticket(plan: UploadPlan, holder: UploadHolder): UploadTicket;
  /**
   * Takes the body of a ticket's upload, which uses the ticket up: answers the upload's id. With
   * `admits`, a ticket whose holder it refuses is used up and refused as one the shelf never had
   * (decision 0229).
   */
  receive(
    ticket: string,
    body: Readonly<Uint8Array>,
    admits?: (holder: UploadHolder) => boolean,
  ): Result<string, UploadRefusal>;
  /**
   * The credential that held the ticket of an upload the shelf still keeps, else `undefined`. A
   * launch reads only a picture its proposer uploaded (decision 0236).
   */
  holderOf(upload: string): UploadHolder | undefined;
}

/** How long tickets and uploads last, and how many of each the shelf holds. */
export interface UploadShelfOptions {
  readonly clock: Clock;
  readonly random: Random;
  readonly ticketMs?: number;
  readonly keepMs?: number;
  readonly most?: number;
  readonly mostTickets?: number;
}

interface Planned {
  readonly plan: UploadPlan;
  readonly holder: UploadHolder;
}

interface Received {
  readonly bytes: Readonly<Uint8Array>;
  readonly holder: UploadHolder;
}

interface Kept<T> {
  readonly value: T;
  readonly untilMs: number;
}

// Drops what expired, then the oldest past `most`; a Map keeps its keys in the order they came.
function prune<T>(held: Map<string, Kept<T>>, now: number, most?: number): void {
  for (const [key, kept] of held) {
    if (kept.untilMs <= now) {
      held.delete(key);
    }
  }
  const over = most === undefined ? 0 : Math.max(0, held.size - most);
  for (const oldest of [...held.keys()].slice(0, over)) {
    held.delete(oldest);
  }
}

// The body as the shelf keeps it, with the ticket's holder, once it fits the ticket's plan.
function checked(planned: Planned, body: Readonly<Uint8Array>): Result<Received, UploadRefusal> {
  const { plan, holder } = planned;
  if (body.byteLength > maxImageBytes || body.byteLength > plan.bytes) {
    return err("too_large");
  }
  if (body.byteLength !== plan.bytes) {
    return err("length");
  }
  return imageTypeOf(body) === plan.contentType ? ok({ bytes: body, holder }) : err("format");
}

/** Creates an empty {@link UploadShelf}. */
export function createUploadShelf(options: UploadShelfOptions): UploadShelf {
  const { clock, random } = options;
  const tickets = new Map<string, Kept<Planned>>();
  const uploads = new Map<string, Kept<Received>>();
  const ticketMs = options.ticketMs ?? 120_000;
  const keepMs = options.keepMs ?? 3_600_000;
  const most = options.most ?? 16;
  const mostTickets = options.mostTickets ?? 64;
  const token = (length: number): string => Buffer.from(random.bytes(length)).toString("base64url");
  return {
    ticket(plan, holder) {
      const ticket = token(32);
      const expiresAt = clock.now() + ticketMs;
      tickets.set(ticket, { value: { plan, holder }, untilMs: expiresAt });
      prune(tickets, clock.now(), mostTickets);
      return { ticket, expiresAt };
    },
    receive(ticket, body, admits) {
      prune(tickets, clock.now());
      const planned = tickets.get(ticket)?.value;
      tickets.delete(ticket);
      const isAdmitted = planned !== undefined && (admits?.(planned.holder) ?? true);
      const kept = isAdmitted ? checked(planned, body) : err("ticket" as const);
      if (!kept.ok) {
        return kept;
      }
      const upload = `upl_${token(16)}`;
      uploads.set(upload, { value: kept.value, untilMs: clock.now() + keepMs });
      prune(uploads, clock.now(), most);
      return ok(upload);
    },
    async read(image, call) {
      call.signal.throwIfAborted();
      prune(uploads, clock.now(), most);
      const bytes = uploads.get(image)?.value.bytes;
      if (bytes === undefined) {
        return Promise.resolve(err("unreadable"));
      }
      return Promise.resolve(bytes.byteLength > maxImageBytes ? err("too_large") : ok(bytes));
    },
    holderOf(upload) {
      prune(uploads, clock.now(), most);
      return uploads.get(upload)?.value.holder;
    },
  };
}
