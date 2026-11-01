import {
  type AccountRef,
  accountRefSchema,
  type Amount,
  type AmountWire,
  amountSchema,
  type AssetRef,
  assetRefSchema,
  type BridgeFee,
  type BridgeFeeWire,
} from "@binference/chain";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";
import { type DocumentCodec, documentCodec } from "./intent-documents.schema.js";

/**
 * The deposit a bridge's plan makes (decision 0317): a `bound` deposit names its recipient and
 * least output in its own bytes, an `order` deposit only an order id; the contract it calls, and
 * the id the venue names the destination chain by, which the signer holds the deposit to.
 */
interface BridgeDepositTerms {
  readonly kind: "bound" | "order";
  readonly contract: AccountRef;
  readonly destinationId: string;
}

/**
 * What a bridge's card confirms (spec 6, section 5; decision 0319): the venue, the destination
 * chain's name, the amount sent,
 * who it pays on the destination chain and their recipient bytes, labeled as the address book or
 * the rescue address names them, what the route delivers there and at least how much, the coin a
 * fill may pay in its place, what the bridge keeps, how long it expects to take, when it quoted
 * and until when, and the deposit. A bridge keeps it in the intent's `quote` column, so the card's
 * terms hash binds every part, and the wallet queue and the delivery read hold the bridge to it.
 */
export interface BridgeIntentQuote {
  readonly venue: string;
  /** The destination chain as the registry names it, such as Base. */
  readonly chainName: string;
  readonly amount: Amount;
  readonly recipient: AccountRef;
  readonly recipientBytes: string;
  readonly label?: string;
  readonly isRescue?: true;
  readonly expectedOut: Amount;
  readonly minOut: Amount;
  readonly deliveredAsCoin?: AssetRef;
  readonly fees: readonly BridgeFee[];
  readonly etaSeconds: number;
  readonly quotedAtMs: number;
  readonly expiresAtMs: number;
  readonly deposit: BridgeDepositTerms;
}

/** A {@link BridgeIntentQuote} as JSON carries it. */
interface BridgeIntentQuoteWire {
  readonly venue: string;
  readonly chainName: string;
  readonly amount: AmountWire;
  readonly recipient: string;
  readonly recipientBytes: string;
  readonly label?: string;
  readonly isRescue?: true;
  readonly expectedOut: AmountWire;
  readonly minOut: AmountWire;
  readonly deliveredAsCoin?: string;
  readonly fees: readonly BridgeFeeWire[];
  readonly etaSeconds: number;
  readonly quotedAtMs: number;
  readonly expiresAtMs: number;
  readonly deposit: {
    readonly kind: "bound" | "order";
    readonly contract: string;
    readonly destinationId: string;
  };
}

const feeSchema: z.ZodType<BridgeFee, BridgeFeeWire> = z.strictObject({
  kind: z.enum(["bridge", "relayer", "gas"]),
  amount: amountSchema,
});

const bridgeIntentQuoteSchema: z.ZodType<BridgeIntentQuote, BridgeIntentQuoteWire> = z.strictObject(
  {
    venue: z.string().min(1).max(200),
    chainName: z.string().min(1).max(200),
    amount: amountSchema,
    recipient: accountRefSchema,
    recipientBytes: z.string().regex(/^0x(?:[0-9a-f]{2})+$/),
    label: z.string().min(1).max(200).exactOptional(),
    isRescue: z.literal(true).exactOptional(),
    expectedOut: amountSchema,
    minOut: amountSchema,
    deliveredAsCoin: assetRefSchema.exactOptional(),
    fees: z.array(feeSchema).max(8),
    etaSeconds: z.int().nonnegative(),
    quotedAtMs: epochMsSchema,
    expiresAtMs: epochMsSchema,
    deposit: z.strictObject({
      kind: z.enum(["bound", "order"]),
      contract: accountRefSchema,
      destinationId: z.string().regex(/^[1-9]\d{0,30}$/),
    }),
  },
);

/** A bridge's quote, in the `quote` column of a bridge intent. */
export const bridgeQuoteDocument: DocumentCodec<BridgeIntentQuote> = documentCodec(
  "bridge quote",
  bridgeIntentQuoteSchema,
);
