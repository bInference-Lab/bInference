import type { Id } from "@binference/core";
import type { CardCopy } from "./card-copy.js";
import type { OwnerBinding } from "./owner-binding.js";

/**
 * Keeps which Telegram user owns the install, for the owner's bot. One owner at a time: the first
 * binding stays until the owner removes it from the CLI. Adapters: a SQLite store in
 * `@binference/store`, and an in-memory fake.
 */
export interface OwnerStore {
  /** The owner, or `undefined` before pairing. Rejects with the signal's reason once it aborts. */
  get(options: { readonly signal: AbortSignal }): Promise<OwnerBinding | undefined>;
  /**
   * Binds the owner in place of any earlier one, as a spent start code allows (decision 0139), and
   * answers the owner it replaced, or `undefined` for the first pairing.
   */
  bind(
    binding: OwnerBinding,
    options: { readonly signal: AbortSignal },
  ): Promise<OwnerBinding | undefined>;
}

/**
 * Keeps where each card version was posted in Telegram, so every copy can become its receipt.
 * Adapters: a SQLite store in `@binference/store`, and an in-memory fake.
 */
export interface CardCopyStore {
  /** Keeps a copy; keeping the same message again changes nothing. */
  keep(copy: CardCopy, options: { readonly signal: AbortSignal }): Promise<void>;
  /** The copies of the card version with this callback reference, in the order they were sent. */
  find(ref: string, options: { readonly signal: AbortSignal }): Promise<readonly CardCopy[]>;
  /**
   * The copies of every version of an intent's card, the oldest version first, each version's in
   * the order they were sent.
   */
  ofIntent(
    intent: Id<"int">,
    options: { readonly signal: AbortSignal },
  ): Promise<readonly CardCopy[]>;
}
