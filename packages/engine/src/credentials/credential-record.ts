import type { Secret } from "@binference/core";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";

/** A stored credential as the store keeps it, its value aside: its name, hosts and last store. */
export interface CredentialEntry {
  readonly name: string;
  readonly allowedHosts: readonly string[];
  readonly updatedAtMs: number;
}

/** A credential the owner stores: its value, the hosts it may be sent to, and when. */
export interface CredentialPut {
  readonly name: string;
  readonly value: string;
  readonly allowedHosts: readonly string[];
  readonly atMs: number;
}

/** A stored credential with its value, which stays a `Secret` until the one call that uses it. */
export interface RevealedCredential {
  readonly name: string;
  readonly value: Secret;
  readonly allowedHosts: readonly string[];
}

/**
 * A stored credential with its value, as only {@link CredentialStore.reveal} gives it across the
 * store's worker; the composition root wraps the value in a `Secret` at once.
 */
export interface RevealedCredentialRow {
  readonly name: string;
  readonly value: string;
  readonly allowedHosts: readonly string[];
}

const hosts = z.array(z.string().min(1).max(253)).max(16).readonly();

/** Parses a {@link CredentialEntry}. */
export const credentialEntrySchema: z.ZodType<CredentialEntry> = z.strictObject({
  name: z.string().min(1).max(64),
  allowedHosts: hosts,
  updatedAtMs: epochMsSchema,
});

/** Parses a {@link RevealedCredentialRow}. */
export const revealedCredentialRowSchema: z.ZodType<RevealedCredentialRow> = z.strictObject({
  name: z.string().min(1).max(64),
  value: z.string().min(1).max(65_536),
  allowedHosts: hosts,
});

/** Parses a {@link CredentialPut}. */
export const credentialPutSchema: z.ZodType<CredentialPut> = z.strictObject({
  name: z.string().min(1).max(64),
  value: z.string().min(1).max(65_536),
  allowedHosts: hosts,
  atMs: epochMsSchema,
});
