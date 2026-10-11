import { err, ok, type Result } from "@binference/core";
import {
  type LaunchClaim,
  launchClaimOutcomeSchema,
  launchClaimSchema,
  type LaunchClaimOutcome,
  type LaunchTicketRecord,
  launchTicketRecordSchema,
  maxLaunchTickets,
} from "@binference/engine/access";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

/**
 * Claims a Mini App launch in one transaction: deletes the claims from before `sinceMs`, then
 * answers `seen` for a hash still kept, `no_ticket` for a ticket unknown for the user and
 * `ticket_expired`, deleting it, for an expired one; otherwise it deletes the ticket, keeps the
 * hash and answers `claimed`.
 */
export const claimLaunchTask: StoreTask<LaunchClaim, LaunchClaimOutcome> = defineTask({
  name: "access.claim_launch",
  access: "write",
  input: launchClaimSchema,
  output: launchClaimOutcomeSchema,
  run(database, claim) {
    const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
    execute(kysely.deleteFrom("mini_app_launches").where("seen_at", "<", claim.sinceMs));
    const kept = takeFirst(
      kysely
        .selectFrom("mini_app_launches")
        .select("launch_hash")
        .where("launch_hash", "=", claim.launchHash),
    );
    if (kept !== undefined) {
      return "seen";
    }
    const ticket = takeFirst(
      kysely
        .selectFrom("mini_app_tickets")
        .select("expires_at")
        .where("ticket_hash", "=", claim.ticketHash)
        .where("user_id", "=", claim.userId),
    );
    if (ticket === undefined) {
      return "no_ticket";
    }
    execute(kysely.deleteFrom("mini_app_tickets").where("ticket_hash", "=", claim.ticketHash));
    if (ticket.expires_at <= claim.atMs) {
      return "ticket_expired";
    }
    execute(
      kysely
        .insertInto("mini_app_launches")
        .values({ launch_hash: claim.launchHash, seen_at: claim.atMs }),
    );
    return "claimed";
  },
});

/**
 * Keeps a new launch ticket in one transaction: deletes the tickets expired by its `issuedAtMs`,
 * keeps it, then deletes the oldest past `maxLaunchTickets`. A hash in use is `exists`.
 */
export const addLaunchTicketTask: StoreTask<
  LaunchTicketRecord,
  Result<LaunchTicketRecord, "exists">
> = defineTask({
  name: "access.add_launch_ticket",
  access: "write",
  input: launchTicketRecordSchema,
  output: resultSchema(launchTicketRecordSchema, ["exists"]),
  run(database, ticket) {
    const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
    execute(kysely.deleteFrom("mini_app_tickets").where("expires_at", "<=", ticket.issuedAtMs));
    const taken = takeFirst(
      kysely
        .selectFrom("mini_app_tickets")
        .select("ticket_hash")
        .where("ticket_hash", "=", ticket.ticketHash),
    );
    if (taken !== undefined) {
      return err("exists");
    }
    execute(
      kysely.insertInto("mini_app_tickets").values({
        ticket_hash: ticket.ticketHash,
        user_id: ticket.userId,
        issued_at: ticket.issuedAtMs,
        expires_at: ticket.expiresAtMs,
      }),
    );
    const newest = kysely
      .selectFrom("mini_app_tickets")
      .select("ticket_hash")
      .orderBy("issued_at", "desc")
      .orderBy("ticket_hash", "desc")
      .limit(maxLaunchTickets);
    execute(kysely.deleteFrom("mini_app_tickets").where("ticket_hash", "not in", newest));
    return ok(ticket);
  },
});
