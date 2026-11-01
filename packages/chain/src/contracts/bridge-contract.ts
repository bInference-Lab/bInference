import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import {
  type BridgeQuote,
  type BridgeQuoteRequest,
  bridgeQuoteSchema,
  type DecodedDeposit,
  decodedDepositSchema,
  type DepositRef,
  type SettlementCheck,
} from "../bridges/bridge-terms.js";
import type { Bridge } from "../bridges/ports.js";
import type { AccountRef } from "../caip/account-ref.js";
import { accountRefParts } from "../caip/account-ref.js";
import { assetRefParts } from "../caip/asset-ref.js";

/**
 * A bridge under test. `request` is a route it serves, with the token that leaves capped;
 * `unserved` asks for a delivered asset no route of it reaches; `otherRecipient` is another account
 * of the request's destination chain. `deposits` is the kind of deposit the bridge builds (decision
 * 0317). `filled`, `refunded` and `expired` are deposits it tells as such, and `unseen` one it never
 * saw. `settled` is a fill it takes as its deposit's own, paying `paid`, and `stranger` the same
 * check with the fill's events but a bare transfer left out (decision 0320).
 */
export interface BridgeSubject {
  readonly bridge: Bridge;
  readonly request: BridgeQuoteRequest;
  readonly unserved: BridgeQuoteRequest;
  readonly otherRecipient: AccountRef;
  readonly deposits: DecodedDeposit["kind"];
  readonly filled: { readonly deposit: DepositRef; readonly fill: DepositRef };
  readonly refunded: { readonly deposit: DepositRef; readonly refund: DepositRef };
  readonly expired: DepositRef;
  readonly unseen: DepositRef;
  readonly settled: { readonly check: SettlementCheck; readonly paid: bigint };
  readonly stranger: SettlementCheck;
}

/** Makes a fresh {@link BridgeSubject} for each check. */
export interface BridgeHarness {
  create(): Promise<BridgeSubject>;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

async function quoteOf(subject: BridgeSubject): Promise<BridgeQuote> {
  const quoted = await subject.bridge.quote(subject.request, live());
  assert.ok(quoted.ok);
  return quoted.value;
}

async function quotesServedRoute(harness: BridgeHarness): Promise<void> {
  const subject = await harness.create();
  const quote = bridgeQuoteSchema.parse(bridgeQuoteSchema.encode(await quoteOf(subject)));
  assert.equal(quote.expectedOut.asset, subject.request.deliveredAsset);
  for (const fee of quote.fees) {
    assert.equal(fee.amount.asset, subject.request.amountIn.asset);
    assert.ok(fee.amount.base >= 0n);
  }
}

async function refusesUnserved(harness: BridgeHarness): Promise<void> {
  const { bridge, unserved, request } = await harness.create();
  assert.deepEqual(await bridge.quote(unserved, live()), { ok: false, error: "no_route" });
  const uncapped = { ...request, cappedAssets: [] };
  assert.deepEqual(await bridge.quote(uncapped, live()), { ok: false, error: "no_route" });
}

// A bound deposit names what the host compares with the plan; an order deposit only its order.
function provesDeposit(subject: BridgeSubject, deposit: DecodedDeposit, quote: BridgeQuote): void {
  const { request } = subject;
  assert.equal(deposit.kind, subject.deposits);
  assert.equal(deposit.depositor, request.wallet);
  assert.deepEqual(deposit.amountIn, request.amountIn);
  assert.ok(Object.values(request.contracts).includes(deposit.contract));
  if (deposit.kind === "order") {
    assert.ok(deposit.orderId.length > 0);
    return;
  }
  assert.equal(deposit.recipient, request.recipient);
  assert.equal(deposit.minOut.asset, request.deliveredAsset);
  assert.ok(deposit.minOut.base >= quote.minOut.base);
  assert.ok(deposit.fillDeadlineMs >= quote.expiresAtMs);
}

async function buildsDecodableDeposit(harness: BridgeHarness): Promise<void> {
  const subject = await harness.create();
  const { bridge, request } = subject;
  const quote = await quoteOf(subject);
  const drafts = await bridge.build({ ...request, quote, minOut: quote.minOut }, live());
  const source = accountRefParts(request.wallet).chain;
  assert.ok(drafts.every((draft) => draft.from === request.wallet && draft.chain === source));
  const last = drafts.at(-1);
  assert.ok(last !== undefined);
  const decoded = bridge.decode(last);
  assert.ok(decoded.ok);
  provesDeposit(
    subject,
    decodedDepositSchema.parse(decodedDepositSchema.encode(decoded.value)),
    quote,
  );
  if (decoded.value.kind === "bound") {
    const destination = assetRefParts(decoded.value.minOut.asset).chain;
    assert.ok(bridge.destinations.some((item) => item.chain === destination));
  }
  for (const other of drafts.slice(0, -1)) {
    assert.deepEqual(bridge.decode(other), { ok: false, error: "unknown_call" });
  }
}

async function refusesOtherRequest(harness: BridgeHarness): Promise<void> {
  const subject = await harness.create();
  const { bridge, request } = subject;
  const quote = await quoteOf(subject);
  const larger = { ...request.amountIn, base: request.amountIn.base * 100n };
  const minOut = quote.minOut;
  await assert.rejects(bridge.build({ ...request, amountIn: larger, quote, minOut }, live()));
  const recipient = subject.otherRecipient;
  await assert.rejects(bridge.build({ ...request, recipient, quote, minOut }, live()));
  const higher = { ...quote.minOut, base: quote.minOut.base + 1n };
  await assert.rejects(bridge.build({ ...request, quote, minOut: higher }, live()));
}

async function tellsStatus(harness: BridgeHarness): Promise<void> {
  const { bridge, filled, refunded, expired, unseen } = await harness.create();
  const fill = await bridge.status(filled.deposit, live());
  assert.deepEqual(fill.state, { kind: "filled", fill: filled.fill });
  assert.ok(fill.statusUrl.startsWith("https://"));
  const refund = await bridge.status(refunded.deposit, live());
  assert.deepEqual(refund.state, { kind: "refunded", refund: refunded.refund });
  assert.deepEqual((await bridge.status(expired, live())).state, { kind: "expired" });
  assert.deepEqual((await bridge.status(unseen, live())).state, { kind: "unseen" });
}

async function matchesOwnSettlement(harness: BridgeHarness): Promise<void> {
  const { bridge, settled, stranger } = await harness.create();
  assert.deepEqual(bridge.settlement(settled.check), { ok: true, value: settled.paid });
  assert.deepEqual(bridge.settlement(stranger), { ok: false, error: "not_own" });
  const noEvents = { ...settled.check, settlement: { ...settled.check.settlement, events: [] } };
  assert.deepEqual(bridge.settlement(noEvents), { ok: false, error: "not_own" });
}

async function stopsOnAbort(harness: BridgeHarness): Promise<void> {
  const subject = await harness.create();
  const { bridge, request, filled } = subject;
  const quote = await quoteOf(subject);
  const reason = new Error("stopped");
  const signal = AbortSignal.abort(reason);
  await assert.rejects(bridge.quote(request, { signal }), reason);
  await assert.rejects(
    bridge.build({ ...request, quote, minOut: quote.minOut }, { signal }),
    reason,
  );
  await assert.rejects(bridge.status(filled.deposit, { signal }), reason);
}

/** The contract every `Bridge` passes. */
export function bridgeContract(harness: BridgeHarness): readonly ContractCheck[] {
  return [
    {
      name: "quotes a route it serves in the delivered asset, fees in the input's token",
      run: async () => quotesServedRoute(harness),
    },
    {
      name: "answers no_route for a delivered asset no route reaches or a token with no 24-hour cap",
      run: async () => refusesUnserved(harness),
    },
    {
      name: "builds a deposit of its kind that proves what that kind must, and decodes nothing else",
      run: async () => buildsDecodableDeposit(harness),
    },
    {
      name: "refuses to build a quote for another amount or recipient, or above its least output",
      run: async () => refusesOtherRequest(harness),
    },
    {
      name: "tells a filled, a refunded, an expired and an unseen deposit",
      run: async () => tellsStatus(harness),
    },
    {
      name: "matches a fill to its own deposit by its events alone, never a bare transfer",
      run: async () => matchesOwnSettlement(harness),
    },
    {
      name: "rejects a quote, a build and a status with the signal's reason once it aborts",
      run: async () => stopsOnAbort(harness),
    },
  ];
}
