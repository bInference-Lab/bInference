import { type Id, idSchema } from "@binference/core";
import type { z } from "zod";

/**
 * The type prefix of every protocol id, by the thing it names. An id is the prefix, `_` and a
 * lowercase UUIDv7, such as `int_0190f1c2-3a4b-7c5d-8e6f-0123456789ab`. A client token's id is
 * `tok_`; the token itself is a `bnt_` secret (see `credentialSchema`).
 */
export const idPrefixes = {
  agent: "agt",
  wallet: "wal",
  intent: "int",
  card: "crd",
  confirmation: "cnf",
  transaction: "tx",
  ledgerEntry: "led",
  addressBook: "adr",
  clientToken: "tok",
  longJob: "job",
  notice: "ntc",
  autoOrder: "ord",
  orderFill: "fil",
  alert: "alr",
  webhookRule: "whr",
  schedule: "sch",
  chatSession: "ses",
  chatTurn: "trn",
  consoleDevice: "dev",
  connection: "con",
  backup: "bkp",
  installedPlugin: "plg",
} as const;

/** A thing that carries a protocol id, such as `intent` or `connection`. */
export type IdKind = keyof typeof idPrefixes;

/** The id of one kind of thing: `ProtocolId<"intent">` is an `int_` id. */
export type ProtocolId<K extends IdKind> = Id<(typeof idPrefixes)[K]>;

/**
 * Builds the schema that parses the ids of one kind. Its JSON Schema carries the prefix as a
 * pattern, so clients in other languages see it.
 */
export function protocolIdSchema<K extends IdKind>(kind: K): z.ZodType<ProtocolId<K>, string> {
  const prefix = idPrefixes[kind];
  return idSchema(prefix).meta({ pattern: `^${prefix}_` });
}
