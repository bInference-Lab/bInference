import { decimalStringSchema } from "@binference/plugin-sdk";
import { parseJsonText } from "@binference/plugin-sdk/data";
import type { Address, Hex } from "viem";
import { z } from "zod";
import { type RelayOrder, relayOrderSchema } from "../order/relay-order.schema.js";
import { evmAddressTextSchema, bytesTextSchema, word32TextSchema } from "../wire-values.schema.js";

/** A currency as Relay's answer names it: its chain's id, its address as written, its decimals. */
export interface RelayCurrency {
  readonly chainId: bigint;
  readonly address: string;
  readonly decimals: number;
}

/** One part of what Relay keeps, in a currency of some chain. */
interface RelayFee {
  readonly currency: RelayCurrency;
  readonly amount: bigint;
}

/**
 * Relay's quote answer, read into the bridge's own terms: the deposit step's one
 * transaction, the fees, the time estimate, the currencies in and out, and the order the deposit
 * pays with the payment it asks. An answer without the order, or whose deposit step is not one
 * transaction, never reads.
 */
export interface RelayQuote {
  readonly deposit: {
    readonly from: Address;
    readonly to: Address;
    readonly data: Hex;
    readonly value: bigint;
    readonly chainId: bigint;
  };
  readonly fees: {
    readonly relayerGas: RelayFee;
    readonly relayerService: RelayFee;
    readonly app: RelayFee;
  };
  /** Seconds Relay expects the fill to take. */
  readonly timeEstimate: number;
  readonly currencyIn: RelayCurrency & { readonly amount: bigint };
  readonly currencyOut: RelayCurrency & {
    readonly amount: bigint;
    readonly minimumAmount: bigint;
  };
  readonly orderId: Hex;
  /** Relay's solver's signature over the order id, or `undefined` when the answer carries none. */
  readonly orderSignature: Hex | undefined;
  readonly order: RelayOrder;
  readonly payment: {
    readonly chainId: string;
    readonly depository: string;
    readonly currency: string;
    readonly amount: bigint;
  };
}

// Numbers come as the text the answer wrote (`parseJsonText`), so none passes through a float.
const chainId = z
  .string()
  .regex(/^[1-9]\d{0,30}$/)
  .transform((text) => BigInt(text));
const decimals = z
  .string()
  .regex(/^(?:0|[1-9]\d?)$/)
  .pipe(z.coerce.number<string>().max(36));
const seconds = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,6})$/)
  .pipe(z.coerce.number<string>());
const currency = z.looseObject({ chainId, address: z.string().min(1).max(64), decimals });
const amount = z.looseObject({ currency, amount: decimalStringSchema });
const transaction = z.looseObject({
  from: evmAddressTextSchema,
  to: evmAddressTextSchema,
  data: bytesTextSchema,
  value: decimalStringSchema,
  chainId,
});

const answerSchema = z.looseObject({
  steps: z.array(
    z.looseObject({
      id: z.string().max(64),
      kind: z.string().max(64),
      items: z.array(z.looseObject({ data: z.unknown() })),
    }),
  ),
  fees: z.looseObject({ relayerGas: amount, relayerService: amount, app: amount }),
  details: z.looseObject({
    timeEstimate: seconds,
    currencyIn: amount,
    currencyOut: z.looseObject({
      currency,
      amount: decimalStringSchema,
      minimumAmount: decimalStringSchema,
    }),
  }),
  protocol: z.looseObject({
    v2: z.looseObject({
      orderId: word32TextSchema,
      orderSignature: bytesTextSchema.optional(),
      orderData: relayOrderSchema,
      paymentDetails: z.looseObject({
        chainId: z.string().max(64),
        depository: z.string().max(64),
        currency: z.string().max(64),
        amount: decimalStringSchema,
      }),
    }),
  }),
});

type Answer = z.output<typeof answerSchema>;

// The deposit step: the one step named `deposit`, a transaction with one item.
function depositOf(answer: Answer): RelayQuote["deposit"] | undefined {
  const steps = answer.steps.filter((step) => step.id === "deposit");
  const [step] = steps;
  const [item] = step?.items ?? [];
  if (steps.length !== 1 || step?.kind !== "transaction" || step.items.length !== 1) {
    return undefined;
  }
  const parsed = transaction.safeParse(item?.data);
  return parsed.success ? parsed.data : undefined;
}

const feeOf = (part: z.output<typeof amount>): RelayFee => ({
  currency: part.currency,
  amount: part.amount,
});

/**
 * Reads a quote answer, or `undefined` when it breaks the schema: no order in its protocol data,
 * an order outside the shape the bridge takes, a deposit step that is not one transaction, or a
 * missing fee.
 */
export function readQuoteAnswer(body: string): RelayQuote | undefined {
  const parsed = answerSchema.safeParse(parseJsonText(body));
  const deposit = parsed.success ? depositOf(parsed.data) : undefined;
  if (!parsed.success || deposit === undefined) {
    return undefined;
  }
  const { fees, details, protocol } = parsed.data;
  const { currencyIn, currencyOut } = details;
  return {
    deposit,
    fees: {
      relayerGas: feeOf(fees.relayerGas),
      relayerService: feeOf(fees.relayerService),
      app: feeOf(fees.app),
    },
    timeEstimate: details.timeEstimate,
    currencyIn: { ...currencyIn.currency, amount: currencyIn.amount },
    currencyOut: {
      ...currencyOut.currency,
      amount: currencyOut.amount,
      minimumAmount: currencyOut.minimumAmount,
    },
    orderId: protocol.v2.orderId,
    orderSignature: protocol.v2.orderSignature,
    order: protocol.v2.orderData,
    payment: protocol.v2.paymentDetails,
  };
}
