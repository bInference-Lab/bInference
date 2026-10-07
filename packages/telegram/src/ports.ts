import type { Id, Result } from "@binference/core";
import type { CardCopy } from "./cards/card-copy.js";
import type { CardPress, CardStanding } from "./cards/card-press.js";
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

/**
 * Takes the owner's answers to cards from Telegram; the engine owns it. It finds the card version
 * by its callback reference, checks that the presser is the owner's numeric Telegram id, and
 * stores the answer before it resolves. The first answer to a card wins (spec 4, section 2).
 */
export interface CardAnswers {
  /**
   * Answers a card for a press and says how the card stands. Rejects with the signal's reason
   * once it aborts, and answers nothing.
   */
  answer(press: CardPress, options: { readonly signal: AbortSignal }): Promise<CardStanding>;
}

/** Keeps where each card version was posted in Telegram, so every copy can become its receipt. */
export interface CardCopyStore {
  /** Keeps a copy; keeping the same message again changes nothing. */
  keep(copy: CardCopy, options: { readonly signal: AbortSignal }): Promise<void>;
  /** The copies of the card version with this callback reference, in the order kept. */
  find(ref: string, options: { readonly signal: AbortSignal }): Promise<readonly CardCopy[]>;
  /** The copies of every version of an intent's card, the oldest version first. */
  ofIntent(
    intent: Id<"int">,
    options: { readonly signal: AbortSignal },
  ): Promise<readonly CardCopy[]>;
}
