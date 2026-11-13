import type { Id, Result } from "@binference/core";

/**
 * Why the listing catalog gave no answer: none came before the caller's signal aborted
 * (`unreachable`), or what came does not read as the catalog's signed text (`bad_answer`).
 */
export type CatalogFailure = "unreachable" | "bad_answer";

/**
 * The listing catalog as an engine reads it (decision 0433). Its answers are the catalog's signed
 * envelopes as they came: the install path opens and checks each one itself with the listing keys
 * in force, so an adapter or a transport that lies can install nothing. Each read takes the
 * caller's signal, which carries the caller's time limit, and answers `unreachable` once it aborts,
 * a read still waiting on the network too; no read throws. An adapter stops reading an answer
 * past what the caller takes: 8 envelopes for `find`, one for the others, each within
 * `payloadLimits` of its kind and the envelope's own text.
 */
export interface PluginListingCatalog {
  /** The envelopes of the listings the catalog serves for one package version; none if none. */
  find(
    name: string,
    version: string,
    signal: AbortSignal,
  ): Promise<Result<readonly string[], CatalogFailure>>;
  /** The envelope of one listing's newest version, by its id; none when the catalog has none. */
  get(listing: Id<"pls">, signal: AbortSignal): Promise<Result<string | undefined, CatalogFailure>>;
  /** The envelope of the catalog's newest revocation list. */
  revocations(signal: AbortSignal): Promise<Result<string, CatalogFailure>>;
}
