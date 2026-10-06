import type { Result } from "@binference/core";
import type { OwnerBinding } from "./owner/owner-binding.js";

/**
 * Keeps which Telegram user owns the install. One owner at a time: the first binding stays until
 * the owner removes it from the CLI.
 */
export interface OwnerStore {
  /** The owner, or `undefined` before pairing. Rejects with the signal's reason once it aborts. */
  get(options: { readonly signal: AbortSignal }): Promise<OwnerBinding | undefined>;
  /** Binds the owner; with an owner already bound it changes nothing and is `bound`. */
  bind(
    binding: OwnerBinding,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<OwnerBinding, "bound">>;
}
