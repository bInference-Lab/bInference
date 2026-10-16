import { type Clock, err, ok, type Random, type Result } from "@binference/core";
import { type ImageContentType, maxImageBytes } from "@binference/protocol";
import { imageTypeOf } from "../chat/image-type.js";
import type { OwnerImageSource } from "../chat/ports.js";

/** What `upload/start` names: the image's format and its size. */
export interface UploadPlan {
  readonly contentType: ImageContentType;
  readonly bytes: number;
}

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
 * valid 2 minutes; each upload kept 1 hour, at most 16 at once, the oldest dropped first. It
 * reads uploads as the owner's images by their upload ids.
 */
export interface UploadShelf extends OwnerImageSource {
  /** A ticket for one upload of this plan. */
  ticket(plan: UploadPlan): UploadTicket;
  /** Takes the body of a ticket's upload, which uses the ticket up: answers the upload's id. */
  receive(ticket: string, body: Readonly<Uint8Array>): Result<string, UploadRefusal>;
}

/** How long tickets and uploads last, and how many uploads the shelf holds. */
export interface UploadShelfOptions {
  readonly clock: Clock;
  readonly random: Random;
  readonly ticketMs?: number;
  readonly keepMs?: number;
  readonly most?: number;
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

function checked(
  plan: UploadPlan,
  body: Readonly<Uint8Array>,
): Result<Readonly<Uint8Array>, UploadRefusal> {
  if (body.byteLength > maxImageBytes || body.byteLength > plan.bytes) {
    return err("too_large");
  }
  if (body.byteLength !== plan.bytes) {
    return err("length");
  }
  return imageTypeOf(body) === plan.contentType ? ok(body) : err("format");
}

/** Creates an empty {@link UploadShelf}. */
export function createUploadShelf(options: UploadShelfOptions): UploadShelf {
  const { clock, random } = options;
  const tickets = new Map<string, Kept<UploadPlan>>();
  const uploads = new Map<string, Kept<Readonly<Uint8Array>>>();
  const ticketMs = options.ticketMs ?? 120_000;
  const keepMs = options.keepMs ?? 3_600_000;
  const most = options.most ?? 16;
  const token = (length: number): string => Buffer.from(random.bytes(length)).toString("base64url");
  return {
    ticket(plan) {
      prune(tickets, clock.now());
      const ticket = token(32);
      const expiresAt = clock.now() + ticketMs;
      tickets.set(ticket, { value: plan, untilMs: expiresAt });
      return { ticket, expiresAt };
    },
    receive(ticket, body) {
      prune(tickets, clock.now());
      const plan = tickets.get(ticket)?.value;
      tickets.delete(ticket);
      const kept = plan === undefined ? err("ticket" as const) : checked(plan, body);
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
      const bytes = uploads.get(image)?.value;
      if (bytes === undefined) {
        return Promise.resolve(err("unreadable"));
      }
      return Promise.resolve(bytes.byteLength > maxImageBytes ? err("too_large") : ok(bytes));
    },
  };
}
