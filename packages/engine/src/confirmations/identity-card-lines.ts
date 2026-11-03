import type { AccountRef } from "@binference/chain";
import type { CardLine, CardValue } from "./card-line.js";

/**
 * Every value an identity registration's file publishes, as its card shows them (decision 0334):
 * the agent's name, the owner's description, empty for none, the registering wallet as the file
 * writes it, binference's version, and the page the file names for binference.
 */
export interface IdentityDetails {
  readonly name: string;
  readonly description: string;
  readonly wallet: AccountRef;
  readonly version: string;
  readonly link: string;
}

const text = (value: string): CardValue => ({ type: "text", text: value });

/**
 * The lines under an identity registration's action (spec 4, section 3.9): `card.identity.file`
 * with every field of its registration file, the account whole as the file writes it and an empty
 * description as "none", then `card.identity.fixed` with the parts every file holds: binference's
 * page, the agent marked active, and no other registrations or trust models.
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
    account: text(details.wallet),
    version: text(details.version),
  };
  return [
    { key: "card.identity.file", values },
    { key: "card.identity.fixed", values: { link: text(details.link) } },
  ];
}
