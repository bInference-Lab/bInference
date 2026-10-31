import {
  type AccountRef,
  type ChainFamily,
  isSameAccount,
  type NameResolution,
  type NameResolver,
} from "@binference/chain";

/** A name and the address its card showed, as a send by name stored them. */
export interface CardName {
  readonly name: string;
  readonly address: AccountRef;
}

/**
 * What a send by name finds when its name is read again before it signs: the card's address
 * (`same`), or anything else (`moved`), with the address the name points to now when it points to
 * one, a contract's too.
 */
export type NameRecheck =
  | { readonly kind: "same" }
  | { readonly kind: "moved"; readonly now?: AccountRef };

function addressOf(answer: NameResolution): AccountRef | undefined {
  return answer.kind === "found" || answer.kind === "contract" ? answer.address : undefined;
}

/**
 * Reads the card's name again and compares what it points to with the card's address, in the
 * chain family's canonical form (spec 6, section 5). Only a name that still points to that address,
 * holding no code, is `same`; a moved record, a contract, a name gone or one that no longer
 * normalizes is `moved`. Rejects when the resolver rejects: the caller signs nothing then.
 */
export async function recheckName(
  resolver: NameResolver,
  card: CardName,
  options: { readonly family: ChainFamily; readonly signal: AbortSignal },
): Promise<NameRecheck> {
  const answer = await resolver.resolve(card.name, { signal: options.signal });
  if (answer.kind === "found" && isSameAccount(answer.address, card.address, options.family)) {
    return { kind: "same" };
  }
  const now = addressOf(answer);
  return now === undefined ? { kind: "moved" } : { kind: "moved", now };
}
