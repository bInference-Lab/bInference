import type { CredentialEntry, CredentialPut, RevealedCredential } from "./credential-record.js";

/**
 * The credentials the owner stores for the agents (decisions 0388, 0390 and 0411). A value is
 * written only by the owner and is never listed; only `reveal` reads one back, and only the
 * composition root calls it, for a config key that names the credential, or hands it to the
 * agent's API calls, which put the value in one request; a removed credential is gone from every
 * read at once, and `purge` drops it with its value 30 days later. Storing the name again brings
 * it back. Its SQLite adapter is in `@binference/store`.
 */
export interface CredentialStore {
  /** Every stored credential, by name, its value aside. */
  list(options: { readonly signal: AbortSignal }): Promise<readonly CredentialEntry[]>;
  /** One stored credential by name, its value aside. */
  get(
    name: string,
    options: { readonly signal: AbortSignal },
  ): Promise<CredentialEntry | undefined>;
  /** One stored credential by name with its value, or `undefined`; a removed one is gone. */
  reveal(
    name: string,
    options: { readonly signal: AbortSignal },
  ): Promise<RevealedCredential | undefined>;
  /** Stores a credential in place of any of the name. */
  put(credential: CredentialPut, options: { readonly signal: AbortSignal }): Promise<void>;
  /** Removes a credential at `atMs`; false when none of the name is stored. */
  remove(
    name: string,
    removal: { readonly atMs: number; readonly signal: AbortSignal },
  ): Promise<boolean>;
  /** Drops, with their values, the credentials removed before `beforeMs`; answers how many. */
  purge(beforeMs: number, options: { readonly signal: AbortSignal }): Promise<number>;
}
