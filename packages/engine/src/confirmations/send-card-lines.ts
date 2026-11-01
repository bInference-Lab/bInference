import { accountRefParts } from "@binference/chain";
import type { CardAction } from "./card-action.js";
import type { CardLine, CardValue } from "./card-line.js";

/**
 * The `.bnb` name a send by name resolved when it was proposed, as its card shows it (decision
 * 0308): the name, when it was read, and whether its address is a smart-account wallet (decision
 * 0306).
 */
export interface CardSentName {
  readonly name: string;
  readonly resolvedAtMs: number;
  readonly smartAccount?: true;
}

/** Who a send pays as its card names them: the address book label, and the rescue address. */
export interface CardPayee {
  readonly label?: string;
  readonly isRescue?: true;
}

const text = (value: string): CardValue => ({ type: "text", text: value });

// A recipient shows whole, never shortened (spec 4, section 3.9): it receives money.
function addressOf(action: CardAction<"send">): CardValue {
  return text(accountRefParts(action.recipient).address);
}

// The recipient of `card.send.action` (spec 4, section 3.9): "your rescue address" before the
// rescue address, the address book label before a saved one, the address alone otherwise.
function recipientOf(action: CardAction<"send">): CardValue {
  const address = addressOf(action);
  const label = action.payee?.label;
  if (action.payee?.isRescue === true) {
    return { type: "line", line: { key: "card.value.rescuePayee", values: { address } } };
  }
  return label === undefined
    ? address
    : { type: "line", line: { key: "card.value.payee", values: { label: text(label), address } } };
}

/**
 * A send's action line (spec 4, sections 3.3 and 3.9): `card.send.name` with the name and its
 * address for a send by name, `card.send.action` with the labeled recipient for any other.
 */
export function sendActionLine(action: CardAction<"send">): CardLine {
  const amount: CardValue = { type: "amount", amount: action.amount };
  const { name } = action;
  return name === undefined
    ? { key: "card.send.action", values: { amount, recipient: recipientOf(action) } }
    : {
        key: "card.send.name",
        values: { amount, payee: text(name.name), address: addressOf(action) },
      };
}

/**
 * The lines under a send by name's action line (spec 4, section 3.9): where the name pointed and
 * when, which binference reads again before it signs, then whether that address is a
 * smart-account wallet. None for a send to an address.
 */
export function sendNameLines(action: CardAction<"send">): readonly CardLine[] {
  const { name } = action;
  if (name === undefined) {
    return [];
  }
  const payee = text(name.name);
  const resolved: CardLine = {
    key: "card.send.resolved",
    values: {
      payee,
      address: addressOf(action),
      time: { type: "time", atMs: name.resolvedAtMs },
    },
  };
  const smart: CardLine = { key: "card.send.smartAccount", values: { payee } };
  return name.smartAccount === true ? [resolved, smart] : [resolved];
}

/**
 * The warning that a send by name's address names another name in its reverse record (spec 4,
 * section 3.9). `other` is whoever controls the address's text: each surface escapes and cuts it.
 */
export function reverseDiffersLine(reverse: {
  readonly name: string;
  readonly other: string;
}): CardLine {
  return {
    key: "card.warn.reverseDiffers",
    values: { other: text(reverse.other), payee: text(reverse.name) },
  };
}
