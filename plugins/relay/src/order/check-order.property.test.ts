import { accountRefSchema, BinferenceError } from "@binference/plugin-sdk";
import { successOf } from "@binference/plugin-sdk/testing";
import * as fc from "fast-check";
import { getAddress } from "viem";
import { describe, expect, it } from "vitest";
import { type RelayQuote, readQuoteAnswer } from "../api/quote-answer.schema.js";
import { encodeDepositErc20 } from "../deposit/deposit-call.js";
import { createRelayBridge } from "../relay-bridge.js";
import { relayAskOf } from "../routes/route-query.js";
import { recordedOptions, requestFor, tokens } from "../testing/bridge-fixtures.js";
import usdcToBase from "../testing/recorded/quote-usdc-base.json" with { type: "json" };
import usdtToRobinhood from "../testing/recorded/quote-usdt-robinhood.json" with { type: "json" };
import { lowerHex } from "../wire-values.schema.js";
import { orderProblemOf } from "./check-order.js";
import { orderIdOf } from "./order-id.js";
import type { RelayOrder } from "./relay-order.schema.js";

const live = { signal: new AbortController().signal };
const request = requestFor(tokens.usdc, tokens.baseUsdc);
const depositoryAddress = "0x4cD00E387622C35bDDB9b4c962C136462338BC31";

function recorded(
  answer: object = usdcToBase,
  asked = request,
): {
  readonly quote: RelayQuote;
  readonly ask: NonNullable<ReturnType<typeof relayAskOf>>;
} {
  const quote = readQuoteAnswer(JSON.stringify(answer));
  const ask = relayAskOf(asked, recordedOptions());
  if (quote === undefined || ask === undefined) {
    throw new BinferenceError({ code: "relay.bad_fixture", message: "The recorded quote reads." });
  }
  return { quote, ask };
}

// The quote with its order changed, its id worked out again and named by its deposit, as an API
// that lies about the order but keeps it consistent would answer.
function withOrder(quote: RelayQuote, order: RelayOrder): RelayQuote {
  const orderId = orderIdOf(order) ?? quote.orderId;
  const data = encodeDepositErc20({
    depositor: quote.deposit.from,
    token: getAddress(quote.order.input.currency),
    amount: order.input.amount,
    orderId,
  });
  return { ...quote, order, orderId, deposit: { ...quote.deposit, data } };
}

const hexAddress = fc.stringMatching(/^0x[0-9a-f]{40}$/);

/** One term of the recorded order changed: who it pays, its least output, its input or a refund. */
type OrderEdit =
  | { readonly kind: "recipient"; readonly address: string }
  | { readonly kind: "least"; readonly amount: bigint }
  | { readonly kind: "input"; readonly amount: bigint }
  | { readonly kind: "refund"; readonly address: string };

function editedOrder(order: RelayOrder, edit: OrderEdit): RelayOrder {
  if (edit.kind === "recipient") {
    return { ...order, output: { ...order.output, recipient: edit.address } };
  }
  if (edit.kind === "least") {
    return { ...order, output: { ...order.output, minimumAmount: edit.amount } };
  }
  if (edit.kind === "input") {
    return { ...order, input: { ...order.input, amount: edit.amount } };
  }
  const [first, ...rest] = order.refunds;
  const refunds = first === undefined ? [] : [{ ...first, recipient: edit.address }];
  return { ...order, refunds: [...refunds, ...rest] };
}

const other = (own: string | undefined) => hexAddress.filter((address) => address !== own);
const amountOther = (own: bigint, max: bigint) =>
  fc.bigInt({ min: 1n, max }).filter((amount) => amount !== own);

// Every edit that changes the recorded order: an address or an amount other than its own.
function editsOf(order: RelayOrder): fc.Arbitrary<OrderEdit> {
  const { output, input, refunds } = order;
  return fc.oneof(
    fc.record({ kind: fc.constant("recipient" as const), address: other(output.recipient) }),
    fc.record({
      kind: fc.constant("least" as const),
      amount: amountOther(output.minimumAmount, 10n ** 12n),
    }),
    fc.record({
      kind: fc.constant("input" as const),
      amount: amountOther(input.amount, 10n ** 30n),
    }),
    fc.record({ kind: fc.constant("refund" as const), address: other(refunds[0]?.recipient) }),
  );
}

// The quote with its order's least and expected output and the details' least output all set to
// one amount, as an answer that keeps the order and its fee lines consistent would state it.
function withOutput(quote: RelayQuote, amount: bigint): RelayQuote {
  const output = { ...quote.order.output, minimumAmount: amount, expectedAmount: amount };
  const edited = withOrder(quote, { ...quote.order, output });
  return { ...edited, currencyOut: { ...edited.currencyOut, minimumAmount: amount } };
}

const word = fc.stringMatching(/^0x[0-9a-f]{64}$/);

// Whether an output is at most the input less the fees and misses it by at most the 50 basis
// points the registry caps a swap into USDG at.
const isWithinSwapCap = (amount: bigint, net: bigint): boolean =>
  amount <= net && (net - amount) * 10_000n <= 50n * net;

// The quote with one leg's extra data, or every refund's deadline, other than Relay writes.
function withTerms(
  quote: RelayQuote,
  terms: { readonly extraData: `0x${string}`; readonly deadline: number },
): RelayQuote {
  const refunds = quote.order.refunds.map((refund) => ({ ...refund, deadline: terms.deadline }));
  const output = { ...quote.order.output, extraData: terms.extraData };
  return withOrder(quote, { ...quote.order, output, refunds });
}

describe("a Relay order held to what was asked", () => {
  it("is taken as recorded", () => {
    const { quote, ask } = recorded();
    expect(orderProblemOf(quote, ask, depositoryAddress)).toBeUndefined();
  });

  it("is refused for any other recipient, least output, input or refund, even under a matching id", () => {
    const { quote, ask } = recorded();
    fc.assert(
      fc.property(editsOf(quote.order), (edit) => {
        const edited = withOrder(quote, editedOrder(quote.order, edit));
        expect(orderProblemOf(edited, ask, depositoryAddress)).toBeDefined();
      }),
      { numRuns: 200 },
    );
  });

  it("is refused for any output but the input less the fees, however consistently stated", () => {
    const { quote, ask } = recorded();
    const own = quote.order.output.minimumAmount;
    fc.assert(
      fc.property(amountOther(own, own * 2n), (amount) => {
        expect(orderProblemOf(withOutput(quote, amount), ask, depositoryAddress)).toBeDefined();
      }),
      { numRuns: 200 },
    );
  });

  it("is refused, on a swap into USDG, for any output over the input less the fees or a rate over the cap", () => {
    const { quote, ask } = recorded(usdtToRobinhood, requestFor(tokens.usdt, tokens.robinhoodUsdg));
    const kept = quote.fees.relayerGas.amount + quote.fees.relayerService.amount;
    const unit = 10n ** 12n;
    const net = (ask.amount - kept + unit - 1n) / unit;
    const amounts = fc.oneof(
      fc.bigInt({ min: 1n, max: net + 1_000n }),
      fc.bigInt({ min: (net * 99n) / 100n, max: net + 10n }),
    );
    fc.assert(
      fc.property(amounts, (amount) => {
        const problem = orderProblemOf(withOutput(quote, amount), ask, depositoryAddress);
        expect(problem === undefined).toBe(isWithinSwapCap(amount, net));
      }),
      { numRuns: 300 },
    );
    expect(orderProblemOf(quote, ask, depositoryAddress)).toBeUndefined();
  });

  it("is refused for extra data or refund deadlines other than Relay writes", () => {
    const { quote, ask } = recorded();
    const { extraData, deadline } = quote.order.output;
    const terms = fc.oneof(
      fc.record({
        extraData: word.filter((data) => data !== extraData).map((data) => lowerHex(data)),
        deadline: fc.constant(deadline),
      }),
      fc.record({
        extraData: fc.constant(extraData),
        deadline: fc.integer({ min: 0, max: 0xffff_ffff }).filter((at) => at !== deadline),
      }),
    );
    fc.assert(
      fc.property(terms, (changed) => {
        const edited = withTerms(quote, changed);
        expect(orderProblemOf(edited, ask, depositoryAddress)).toBe("other_terms");
      }),
      { numRuns: 200 },
    );
  });
});

describe("a Relay quote's build", () => {
  it("is refused for any other amount or recipient than the quote was given for", async () => {
    const bridge = createRelayBridge(recordedOptions());
    const quote = successOf(await bridge.quote(request, live));
    const amounts = fc
      .bigInt({ min: 1n, max: 10n ** 30n })
      .filter((base) => base !== request.amountIn.base);
    const recipients = hexAddress
      .map((address) => accountRefSchema.parse(`eip155:8453:${address}`))
      .filter((recipient) => recipient.toLowerCase() !== request.recipient.toLowerCase());
    const changes = fc.oneof(
      amounts.map((base) => ({ amountIn: { asset: request.amountIn.asset, base } })),
      recipients.map((recipient) => ({ recipient })),
    );
    await fc.assert(
      fc.asyncProperty(changes, async (change) => {
        const built = bridge.build({ ...request, ...change, quote, minOut: quote.minOut }, live);
        await expect(built).rejects.toMatchObject({ code: "relay.quote_mismatch" });
      }),
      { numRuns: 60 },
    );
  });
});
