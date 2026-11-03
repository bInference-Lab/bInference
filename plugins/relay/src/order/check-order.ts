import type { Address } from "viem";
import type { RelayCurrency, RelayQuote } from "../api/quote-answer.schema.js";
import { readDepositErc20 } from "../deposit/deposit-call.js";
import { relayChainNamed, relayLegData } from "../relay-chains.js";
import type { RelayAsk } from "../routes/route-query.js";
import { orderIdOf } from "./order-id.js";
import type { OrderRefund, RelayOrder } from "./relay-order.schema.js";

/** Why an answer is not the bridge the bridge asked for, each a check of its own. */
export type OrderProblem =
  | "not_its_order"
  | "other_payment"
  | "other_refund"
  | "other_deposit"
  | "other_currencies"
  | "other_fees"
  | "other_terms";

// Two accounts of one chain are the same: EVM hex in any case, Solana base58 as written.
function isSame(vm: RelayAsk["origin"]["vm"], left: string, right: string): boolean {
  return vm === "evm" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

const isSameEvm = (left: string, right: string): boolean => isSame("evm", left, right);

const bpsPerWhole = 10_000n;

// The order is the one its id names, worked out from its data, and Relay's solver takes it.
function isOwnOrder(quote: RelayQuote, ask: RelayAsk): boolean {
  return (
    orderIdOf(quote.order) === quote.orderId &&
    quote.order.solver.toLowerCase() === ask.solver.toLowerCase()
  );
}

// The order is paid exactly the asked input on the asked chain, and pays the asked recipient in
// the asked token on the asked chain, at least what it expects, with nothing to spare.
function paysAsked(order: RelayOrder, ask: RelayAsk): boolean {
  const { input, output } = order;
  const { vm } = ask.destination;
  return (
    input.chainId === ask.origin.protocol &&
    isSameEvm(input.currency, ask.tokenIn) &&
    input.amount === ask.amount &&
    input.weight === 1n &&
    output.chainId === ask.destination.protocol &&
    isSame(vm, output.recipient, ask.recipient) &&
    isSame(vm, output.currency, ask.currencyOut) &&
    output.minimumAmount > 0n &&
    output.minimumAmount === output.expectedAmount
  );
}

// A refund goes to the wallet in the token it sent on its own chain, or to the recipient in the
// token it would get on the destination: nobody else, in nothing else.
function isOwnRefund(refund: OrderRefund, ask: RelayAsk): boolean {
  const { origin, destination } = ask;
  const toWallet =
    refund.chainId === origin.protocol &&
    isSameEvm(refund.recipient, ask.depositor) &&
    isSameEvm(refund.currency, ask.tokenIn);
  const toRecipient =
    refund.chainId === destination.protocol &&
    isSame(destination.vm, refund.recipient, ask.recipient) &&
    isSame(destination.vm, refund.currency, ask.currencyOut);
  return toWallet || toRecipient;
}

function refundsOwn(order: RelayOrder, ask: RelayAsk): boolean {
  return (
    order.refunds.every((refund) => isOwnRefund(refund, ask)) &&
    order.refunds.some((refund) => refund.chainId === ask.origin.protocol)
  );
}

// The payment Relay asks for: exactly the input, to the registry's depository, on the wallet's chain.
function paymentAsked(quote: RelayQuote, ask: RelayAsk, depository: Address): boolean {
  const { payment } = quote;
  return (
    payment.chainId === ask.origin.protocol &&
    isSameEvm(payment.depository, depository) &&
    isSameEvm(payment.currency, ask.tokenIn) &&
    payment.amount === ask.amount
  );
}

// The deposit pays the registry's depository exactly the order's input from the wallet, with no
// coin, and names the order's id.
function depositsAsked(quote: RelayQuote, ask: RelayAsk, depository: Address): boolean {
  const { deposit } = quote;
  const terms = readDepositErc20(deposit.data);
  const isCall =
    deposit.chainId === BigInt(ask.origin.id) &&
    deposit.from === ask.depositor &&
    deposit.to === depository &&
    deposit.value === 0n;
  return (
    isCall &&
    terms?.depositor === ask.depositor &&
    terms.token === ask.tokenIn &&
    terms.amount === ask.amount &&
    terms.orderId === quote.orderId
  );
}

function isCurrency(
  currency: RelayCurrency,
  expected: {
    readonly vm: RelayAsk["origin"]["vm"];
    readonly id: string;
    readonly address: string;
  },
  decimals: number,
): boolean {
  return (
    currency.chainId === BigInt(expected.id) &&
    isSame(expected.vm, currency.address, expected.address) &&
    currency.decimals === decimals
  );
}

// The details name the asked tokens with the registry's decimals, the asked input and the order's
// least output.
function namesCurrencies(quote: RelayQuote, ask: RelayAsk): boolean {
  const { currencyIn, currencyOut } = quote;
  const { origin, destination, route } = ask;
  return (
    isCurrency(currencyIn, { ...origin, address: ask.tokenIn }, route.decimals.leaves) &&
    isCurrency(currencyOut, { ...destination, address: ask.currencyOut }, route.decimals.arrives) &&
    currencyIn.amount === ask.amount &&
    currencyOut.minimumAmount === quote.order.output.minimumAmount
  );
}

// The terms the id commits to that no ask names, as Relay writes them today: the solver settles on
// a chain Relay lists, every refund holds as long as the output, and every leg's extra data is
// empty or Relay's own word.
function termsAsRelayWrites(order: RelayOrder): boolean {
  const legs = [order.output, ...order.refunds];
  return (
    relayChainNamed(order.solverChainId) !== undefined &&
    order.refunds.every((refund) => refund.deadline === order.output.deadline) &&
    legs.every((leg) => leg.extraData === "0x" || leg.extraData === relayLegData)
  );
}

// The input less what the solver keeps, at the output token's decimals, rounded up as Relay does.
function netOf(quote: RelayQuote, ask: RelayAsk): bigint {
  const net = ask.amount - quote.fees.relayerGas.amount - quote.fees.relayerService.amount;
  const shift = ask.route.decimals.arrives - ask.route.decimals.leaves;
  if (shift >= 0) {
    return net * 10n ** BigInt(shift);
  }
  const unit = 10n ** BigInt(-shift);
  return (net + unit - 1n) / unit;
}

// The order pays exactly the input less the solver's fees; on a route Relay fills by a swap into
// another token, at most that and at least it less the route's cap on the swap's rate, the rate
// rounded up (decision 0323).
function paysNet(quote: RelayQuote, ask: RelayAsk): boolean {
  const net = netOf(quote, ask);
  const least = quote.order.output.minimumAmount;
  const cap = ask.route.swapCapBps;
  if (cap === undefined) {
    return least === net;
  }
  const gap = net - least;
  return net > 0n && gap >= 0n && gap * bpsPerWhole <= BigInt(cap) * net;
}

// Every fee is in the token that leaves, no app fee is taken, and the order pays the input less
// the solver's fees: the fees a card shows, and on a swap its rate, are what Relay keeps at most.
function isFeesInInput(quote: RelayQuote, ask: RelayAsk): boolean {
  const { relayerGas, relayerService, app } = quote.fees;
  const inInput = [relayerGas, relayerService, app].every((fee) =>
    isCurrency(fee.currency, { ...ask.origin, address: ask.tokenIn }, ask.route.decimals.leaves),
  );
  return inInput && app.amount === 0n && paysNet(quote, ask);
}

/**
 * The first problem with a Relay quote for what the bridge asked, or `undefined` when it is the
 * asked bridge (Relay's input validation guide, and decision 0317): its order is the one its id
 * names and Relay's solver takes; it is paid exactly the input and pays the asked recipient the
 * asked token on the asked chain with no slippage; every refund goes to the wallet or to the
 * recipient; the deposit pays the registry's depository from the wallet and names the order's
 * id; the details name the asked tokens with the registry's decimals; every fee is in the token
 * that leaves and the output is exactly the input less them; and the terms no ask names are as
 * Relay writes them. Relay's signature over the id is checked apart (`isSignedBySolver`).
 */
export function orderProblemOf(
  quote: RelayQuote,
  ask: RelayAsk,
  depository: Address,
): OrderProblem | undefined {
  const checks: readonly (readonly [OrderProblem, () => boolean])[] = [
    ["not_its_order", () => isOwnOrder(quote, ask)],
    ["other_payment", () => paysAsked(quote.order, ask)],
    ["other_refund", () => refundsOwn(quote.order, ask)],
    ["other_deposit", () => paymentAsked(quote, ask, depository)],
    ["other_deposit", () => depositsAsked(quote, ask, depository)],
    ["other_currencies", () => namesCurrencies(quote, ask)],
    ["other_fees", () => isFeesInInput(quote, ask)],
    ["other_terms", () => termsAsRelayWrites(quote.order)],
  ];
  return checks.find(([, passes]) => !passes())?.[0];
}
