import type { IdentityRegistry } from "@binference/chain/identity";

/**
 * What the engine registers identities with (decisions 0334 and 0335): the identity registries
 * it runs, the first one the one a registration uses, and binference's release version, which a
 * registration file publishes whole.
 */
export interface IdentityOptions {
  readonly registries: readonly IdentityRegistry[];
  readonly version: string;
}
