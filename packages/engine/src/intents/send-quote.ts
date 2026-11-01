import {
  type AccountRef,
  accountRefSchema,
  type Amount,
  type AmountWire,
  amountSchema,
} from "@binference/chain";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";
import { type DocumentCodec, documentCodec } from "./intent-documents.schema.js";

/**
 * The `.bnb` name a send by name resolved when it was proposed, as its card shows it (decision
 * 0308): the name in its normalized form, when it was read, whether the address is a
 * smart-account wallet (decision 0306), and the other name the address's reverse record gives,
 * which whoever controls the address sets, so a surface escapes and cuts it.
 */
export interface SentName {
  readonly name: string;
  readonly resolvedAtMs: number;
  readonly smartAccount?: true;
  readonly reverseOther?: string;
}

/**
 * Who a send pays as its card names them (spec 4, section 3.9): the address book label of the
 * recipient, whether it is the install's rescue address in effect, and whether no earlier send of
 * the agent landed there, each as read when the send was quoted.
 */
export interface SentPayee {
  readonly label?: string;
  readonly isRescue?: true;
  readonly isNewRecipient?: true;
}

/**
 * What a send's card confirms (spec 6, section 5): the amount, the account it pays, in its
 * family's canonical form, who that is, and the name it was resolved from, and when that was. A
 * send keeps it in the intent's `quote` column, so the card's terms hash binds the address, the
 * label and the name, and the wallet queue reads the name again against it.
 */
export interface SendQuote extends SentPayee {
  readonly amount: Amount;
  readonly recipient: AccountRef;
  readonly name?: SentName;
  readonly quotedAtMs: number;
}

/** A {@link SendQuote} as JSON carries it. */
interface SendQuoteWire extends SentPayee {
  readonly amount: AmountWire;
  readonly recipient: string;
  readonly name?: SentName;
  readonly quotedAtMs: number;
}

const sentNameSchema: z.ZodType<SentName, SentName> = z.strictObject({
  name: z.string().min(1).max(255),
  resolvedAtMs: epochMsSchema,
  smartAccount: z.literal(true).exactOptional(),
  reverseOther: z.string().max(1_000).exactOptional(),
});

const sendQuoteSchema: z.ZodType<SendQuote, SendQuoteWire> = z.strictObject({
  amount: amountSchema,
  recipient: accountRefSchema,
  name: sentNameSchema.exactOptional(),
  label: z.string().min(1).max(200).exactOptional(),
  isRescue: z.literal(true).exactOptional(),
  isNewRecipient: z.literal(true).exactOptional(),
  quotedAtMs: epochMsSchema,
});

/** A send's quote, in the `quote` column of a send intent. */
export const sendQuoteDocument: DocumentCodec<SendQuote> = documentCodec(
  "send quote",
  sendQuoteSchema,
);
