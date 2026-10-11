import { Buffer } from "node:buffer";
import { BinferenceError, type Clock, type Random } from "@binference/core";
import { z } from "zod";
import type { AccessStore } from "../ports.js";
import { epochMsSchema } from "../records/record-fields.js";
import { type Sha256Hex, sha256Hex, sha256HexSchema } from "../records/sha256-hex.js";

/** How long a Mini App launch ticket works: 5 minutes, as long as a launch is fresh. */
export const launchTicketLifetimeMs: number = 5 * 60_000;

/** The most launch tickets kept at once; a new one past it drops the oldest. */
export const maxLaunchTickets: number = 16;

const ticketBytes = 32;

/**
 * The hash a Mini App launch ticket is stored under. The hash names its purpose, so a ticket never
 * matches a pairing code's hash, nor a code a ticket's.
 */
export function launchTicketHash(ticket: string): Sha256Hex {
  return sha256Hex(`mini-app-ticket:${ticket}`);
}

/**
 * A single-use ticket `/console` puts in the Mini App's address, kept as its hash with the
 * Telegram user it was made for; a Mini App sign-in needs one and spends it.
 */
export interface LaunchTicketRecord {
  readonly ticketHash: Sha256Hex;
  /** The numeric Telegram id of the owner who asked for it. */
  readonly userId: number;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
}

/** Parses a launch ticket record; it expires after it was issued. */
export const launchTicketRecordSchema: z.ZodType<LaunchTicketRecord> = z
  .strictObject({
    ticketHash: sha256HexSchema,
    userId: z.int().positive(),
    issuedAtMs: epochMsSchema,
    expiresAtMs: epochMsSchema,
  })
  .refine((ticket) => ticket.expiresAtMs > ticket.issuedAtMs, {
    message: "expiresAtMs must lie after issuedAtMs.",
  });

/** What {@link issueLaunchTicket} stores the ticket through. */
export interface LaunchTicketOptions {
  readonly access: AccessStore;
  readonly clock: Clock;
  readonly random: Random;
}

/**
 * Makes a Mini App launch ticket for the Telegram user from 32 random bytes in base64url, and
 * stores only its hash, valid {@link launchTicketLifetimeMs}. The ticket is a secret: it goes into
 * the button's address once and is never logged. Throws `engine.ticket_taken` on the rare
 * collision with a stored ticket.
 */
export async function issueLaunchTicket(
  options: LaunchTicketOptions,
  request: { readonly userId: number; readonly signal: AbortSignal },
): Promise<string> {
  const ticket = Buffer.from(options.random.bytes(ticketBytes)).toString("base64url");
  const issuedAtMs = options.clock.now();
  const record = {
    ticketHash: launchTicketHash(ticket),
    userId: request.userId,
    issuedAtMs,
    expiresAtMs: issuedAtMs + launchTicketLifetimeMs,
  };
  const added = await options.access.addLaunchTicket(record, { signal: request.signal });
  if (!added.ok) {
    throw new BinferenceError({
      code: "engine.ticket_taken",
      message: "A new launch ticket collided with a stored one; ask for another.",
    });
  }
  return ticket;
}
