import type { CarriedRow } from "@binference/engine/backups";
import type { Insertable } from "kysely";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";

const text = z.string();
const time = z.int();
const maybeTime = z.int().nullable();

/** The access tables a restore copies whole, each table after the one its rows name. */
export const accessTables = [
  "tokens",
  "devices",
  "web_push_subscriptions",
  "pair_codes",
  "mini_app_launches",
  "mini_app_tickets",
] as const;

/** One access table. */
export type AccessTable = (typeof accessTables)[number];

/** Each access table's rows as a restore carries them; the table's own checks apply on insert. */
const rowSchemas: { readonly [T in AccessTable]: z.ZodType<Insertable<EngineTables[T]>> } = {
  tokens: z.strictObject({
    id: text,
    label: text,
    kind: text,
    scopes: text,
    secret_hash: text,
    created_at: time,
    last_used_at: maybeTime,
    revoked_at: maybeTime,
    expires_at: maybeTime,
  }),
  devices: z.strictObject({
    id: text,
    label: text,
    alg: text,
    public_key: text,
    created_at: time,
    last_seen_at: maybeTime,
    revoked_at: maybeTime,
  }),
  web_push_subscriptions: z.strictObject({
    endpoint: text,
    device_id: text,
    p256dh: text,
    auth: text,
    server_key: text,
    created_at: time,
  }),
  pair_codes: z.strictObject({ code_hash: text, expires_at: time, used_at: maybeTime }),
  mini_app_launches: z.strictObject({ launch_hash: text, seen_at: time }),
  mini_app_tickets: z.strictObject({
    ticket_hash: text,
    user_id: time,
    issued_at: time,
    expires_at: time,
  }),
};

/** Parses one carried row of an access table into the row its table takes. */
export function accessRowOf<T extends AccessTable>(
  table: T,
  row: CarriedRow,
): Insertable<EngineTables[T]> {
  return rowSchemas[table].parse(row);
}
