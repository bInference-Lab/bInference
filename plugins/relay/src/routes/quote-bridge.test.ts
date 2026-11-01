import { BinferenceError, type Clock } from "@binference/plugin-sdk";
import { parseJsonText } from "@binference/plugin-sdk/data";
import { createManualClock, createScriptedHttp } from "@binference/plugin-sdk/testing";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readQuoteAnswer } from "../api/quote-answer.schema.js";
import { quoteUrl } from "../api/relay-api.js";
import { encodeDepositErc20 } from "../deposit/deposit-call.js";
import { orderProblemOf } from "../order/check-order.js";
import { orderIdOf } from "../order/order-id.js";
import { relayOrderSchema } from "../order/relay-order.schema.js";
import { createRelayBridge } from "../relay-bridge.js";
import { recordedOptions, requestFor, tokens } from "../testing/bridge-fixtures.js";
import usdcToBase from "../testing/recorded/quote-usdc-base.json" with { type: "json" };
import { relayAskOf } from "./route-query.js";

type Answer = typeof usdcToBase;

const signal = new AbortController().signal;
const stranger = `0x${"33".repeat(20)}`;
const strangerWord = `0x${"00".repeat(12)}${"33".repeat(20)}`;
const request = requestFor(tokens.usdc, tokens.baseUsdc);
// A key that is not Relay's solver's, made up for the test.
const otherKey = privateKeyToAccount(`0x${"42".repeat(32)}`);

// The first item of a recorded list, which every recorded answer holds.
function firstOf<T>(items: readonly T[]): T {
  const [first] = items;
  if (first === undefined) {
    throw new BinferenceError({ code: "relay.bad_fixture", message: "A recorded list is empty." });
  }
  return first;
}

const orderOf = (answer: Answer) =>
  relayOrderSchema.parse(
    z
      .looseObject({ protocol: z.looseObject({ v2: z.looseObject({ orderData: z.unknown() }) }) })
      .parse(parseJsonText(JSON.stringify(answer))).protocol.v2.orderData,
  );

const depositData = (orderId: Hex): Hex =>
  encodeDepositErc20({
    depositor: "0x1111111111111111111111111111111111111111",
    token: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    amount: 20n * 10n ** 18n,
    orderId,
  });

const depositItem = (answer: Answer) => firstOf(firstOf(answer.steps.slice(1)).items);
const payment = (answer: Answer) => firstOf(answer.protocol.v2.orderData.output.payments);
const input = (answer: Answer) => firstOf(answer.protocol.v2.orderData.inputs);
const refunds = (answer: Answer) => input(answer).refunds;

/** One edit of the recorded answer, and whether its order id is worked out again after it. */
interface Edit {
  readonly name: string;
  readonly edit: (answer: Answer) => void;
  readonly rehash: boolean;
  readonly problem: string;
}

// The recorded answer edited and, when asked, its order id worked out again and named by its
// deposit, as an API that lies about the order but keeps it consistent would answer. Its
// signature stays the solver's over the recorded id.
function edited(change: Pick<Edit, "edit" | "rehash">): Answer {
  const answer = structuredClone(usdcToBase);
  change.edit(answer);
  const orderId = orderIdOf(orderOf(answer));
  if (change.rehash && orderId !== undefined) {
    Object.assign(answer.protocol.v2, { orderId });
    Object.assign(depositItem(answer).data, { data: depositData(orderId) });
  }
  return answer;
}

// What the order checks say of an answer, its signature aside.
function problemOf(answer: Answer) {
  const quote = readQuoteAnswer(JSON.stringify(answer));
  const ask = relayAskOf(request, recordedOptions());
  if (quote === undefined || ask === undefined) {
    throw new BinferenceError({ code: "relay.bad_fixture", message: "The edited answer reads." });
  }
  return orderProblemOf(quote, ask, "0x4cD00E387622C35bDDB9b4c962C136462338BC31");
}

async function quoteFrom(answer: Answer, clock?: Clock) {
  const response = { status: 200, headers: {}, body: JSON.stringify(answer) };
  const http = createScriptedHttp([{ method: "POST", url: quoteUrl, response }]);
  const options = recordedOptions(http);
  return createRelayBridge(clock === undefined ? options : { ...options, clock }).quote(request, {
    signal,
  });
}

const lowered = "19899079";

// Whether an edit changes the order, so its id is not the one Relay's solver signed.
const renamesOrder = (change: Pick<Edit, "edit" | "rehash">): boolean =>
  orderIdOf(orderOf(edited(change))) !== usdcToBase.protocol.v2.orderId;

const edits: readonly Edit[] = [
  {
    name: "an order whose data its id does not name",
    edit: (answer) => Object.assign(payment(answer), { recipient: stranger }),
    rehash: false,
    problem: "not_its_order",
  },
  {
    name: "an order another solver takes",
    edit: (answer) => Object.assign(answer.protocol.v2.orderData, { solver: stranger }),
    rehash: true,
    problem: "not_its_order",
  },
  {
    name: "an order paying another recipient",
    edit: (answer) => Object.assign(payment(answer), { recipient: stranger }),
    rehash: true,
    problem: "other_payment",
  },
  {
    name: "an order whose least output is under what it expects",
    edit: (answer) => Object.assign(payment(answer), { minimumAmount: "1" }),
    rehash: true,
    problem: "other_payment",
  },
  {
    name: "an order paid more than the input",
    edit: (answer) => Object.assign(input(answer).payment, { amount: "20000000000000000001" }),
    rehash: true,
    problem: "other_payment",
  },
  {
    name: "an order refunding a stranger",
    edit: (answer) => Object.assign(firstOf(refunds(answer)), { recipient: stranger }),
    rehash: true,
    problem: "other_refund",
  },
  {
    name: "a payment to another depository",
    edit: (answer) => Object.assign(answer.protocol.v2.paymentDetails, { depository: stranger }),
    rehash: true,
    problem: "other_deposit",
  },
  {
    name: "a deposit sent to another contract",
    edit: (answer) => Object.assign(depositItem(answer).data, { to: stranger }),
    rehash: true,
    problem: "other_deposit",
  },
  {
    name: "a deposit naming another order",
    edit: (answer) =>
      Object.assign(depositItem(answer).data, { data: depositData(`0x${"44".repeat(32)}`) }),
    rehash: false,
    problem: "other_deposit",
  },
  {
    name: "a token that arrives with other decimals than the registry's",
    edit: (answer) => Object.assign(answer.details.currencyOut.currency, { decimals: 18 }),
    rehash: true,
    problem: "other_currencies",
  },
  {
    name: "an app fee",
    edit: (answer) => Object.assign(answer.fees.app, { amount: "1" }),
    rehash: true,
    problem: "other_fees",
  },
  {
    name: "a fee in another token",
    edit: (answer) => Object.assign(answer.fees.relayerService.currency, { address: stranger }),
    rehash: true,
    problem: "other_fees",
  },
  {
    name: "an output under the input less the fees, its least and expected lowered together",
    edit: (answer) => {
      Object.assign(payment(answer), { minimumAmount: lowered, expectedAmount: lowered });
      Object.assign(answer.details.currencyOut, { minimumAmount: lowered });
    },
    rehash: true,
    problem: "other_fees",
  },
  {
    name: "other extra data on the output",
    edit: (answer) => Object.assign(answer.protocol.v2.orderData.output, { extraData: stranger }),
    rehash: true,
    problem: "other_terms",
  },
  {
    name: "another word as every refund's extra data",
    edit: (answer) => {
      for (const refund of refunds(answer)) {
        Object.assign(refund, { extraData: strangerWord });
      }
    },
    rehash: true,
    problem: "other_terms",
  },
  {
    name: "refunds that end before the output",
    edit: (answer) => {
      for (const refund of refunds(answer)) {
        Object.assign(refund, { deadline: 1 });
      }
    },
    rehash: true,
    problem: "other_terms",
  },
  {
    name: "a solver chain Relay does not list",
    edit: (answer) => Object.assign(answer.protocol.v2.orderData, { solverChainId: "tron" }),
    rehash: true,
    problem: "other_terms",
  },
];

describe("a Relay order held to what was asked", () => {
  it("passes the order checks as recorded", () => {
    expect(problemOf(edited({ edit: () => undefined, rehash: true }))).toBeUndefined();
  });

  it.each(edits)("refuses $name as $problem", (change) => {
    expect(problemOf(edited(change))).toBe(change.problem);
  });
});

// The edits that change the order, so their id is not the one Relay's solver signed.
const renamedEdits = edits.filter((change) => change.rehash && renamesOrder(change));

const onArbitrum = (answer: Answer) =>
  Object.assign(answer.protocol.v2.orderData, { solverChainId: "arbitrum" });

describe("a Relay quote", () => {
  it("takes the recorded answer as it is", async () => {
    await expect(quoteFrom(usdcToBase)).resolves.toMatchObject({ ok: true });
  });

  it.each(renamedEdits)(
    "refuses $name, its id worked out again, as an order Relay's solver never signed",
    async (change) => {
      await expect(quoteFrom(edited(change))).rejects.toMatchObject({
        code: "relay.unsigned_order",
      });
    },
  );

  it("refuses a solver chain Relay lists but did not sign, as an unsigned order", async () => {
    expect(problemOf(edited({ edit: onArbitrum, rehash: true }))).toBeUndefined();
    await expect(quoteFrom(edited({ edit: onArbitrum, rehash: true }))).rejects.toMatchObject({
      code: "relay.unsigned_order",
    });
  });

  it("refuses an answer without the solver's signature, or with another key's", async () => {
    const unsigned = structuredClone(usdcToBase);
    Reflect.deleteProperty(unsigned.protocol.v2, "orderSignature");
    const raw = z
      .string()
      .regex(/^0x[0-9a-f]{64}$/)
      .parse(usdcToBase.protocol.v2.orderId);
    const signature = await otherKey.signMessage({ message: { raw: `0x${raw.slice(2)}` } });
    const otherSigned = structuredClone(usdcToBase);
    Object.assign(otherSigned.protocol.v2, { orderSignature: signature });
    await expect(quoteFrom(unsigned)).rejects.toMatchObject({ code: "relay.unsigned_order" });
    await expect(quoteFrom(otherSigned)).rejects.toMatchObject({ code: "relay.unsigned_order" });
  });

  it("refuses a signed order whose id its data does not name", async () => {
    await expect(quoteFrom(edited(firstOf(edits)))).rejects.toMatchObject({
      code: "relay.bad_quote",
      details: { problem: "not_its_order" },
    });
  });

  it("refuses an order that stops being fillable before the quote expires", async () => {
    const holdsMs = (3_600 - 300) * 1_000;
    const late = usdcToBase.protocol.v2.orderData.output.deadline * 1_000 - holdsMs + 1;
    await expect(quoteFrom(usdcToBase, createManualClock(late))).rejects.toMatchObject({
      code: "relay.bad_quote",
      details: { problem: "short_deadline" },
    });
  });

  it("refuses an answer with a call on arrival as outside its schema", async () => {
    const withCall = JSON.stringify(usdcToBase).replace('"calls":[]', '"calls":["0x00"]');
    const response = { status: 200, headers: {}, body: withCall };
    const http = createScriptedHttp([{ method: "POST", url: quoteUrl, response }]);
    await expect(
      createRelayBridge(recordedOptions(http)).quote(request, { signal }),
    ).rejects.toMatchObject({ code: "relay.unavailable" });
  });

  it("asks nothing for a token that leaves without a 24-hour cap", async () => {
    const http = createScriptedHttp([]);
    const uncapped = { ...request, cappedAssets: [] };
    await expect(
      createRelayBridge(recordedOptions(http)).quote(uncapped, { signal }),
    ).resolves.toStrictEqual({ ok: false, error: "no_route" });
    expect(http.requests()).toStrictEqual([]);
  });
});
