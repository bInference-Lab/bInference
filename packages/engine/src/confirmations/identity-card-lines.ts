import { type AccountRef, accountRefParts } from "@binference/chain";
import type { CardLine, CardValue } from "./card-line.js";

/**
 * Every field an identity registration's file publishes, as its card shows them (decision 0334):
 * the agent's name, the owner's description, empty for none, the registering wallet and
 * binference's version.
 */
export interface IdentityDetails {
  readonly name: string;
  readonly description: string;
  readonly wallet: AccountRef;
  readonly version: string;
}

const text = (value: string): CardValue => ({ type: "text", text: value });

/**
 * The lines under an identity registration's action (spec 4, section 3.9): `card.identity.file`
 * with every field of its registration file, the account whole and an empty description as
 * "none".
 */
export function identityDetailLines(action: {
  readonly details?: IdentityDetails;
}): readonly CardLine[] {
  const { details } = action;
  if (details === undefined) {
    return [];
  }
  const none: CardValue = {
    type: "line",
    line: { key: "card.identity.noDescription", values: {} },
  };
  const values = {
    agentName: text(details.name),
    description: details.description === "" ? none : text(details.description),
    account: text(accountRefParts(details.wallet).address),
    version: text(details.version),
  };
  return [{ key: "card.identity.file", values }];
}
