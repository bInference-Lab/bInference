import { BinferenceError, err, ok, type Result } from "@binference/core";
import { z } from "zod";
import type {
  BoundDeposit,
  BridgeBuildRequest,
  BridgeQuoteRequest,
  DecodedDeposit,
  DepositRef,
  DepositState,
  OrderDeposit,
  SettlementCheck,
} from "../bridges/bridge-terms.js";
import type { Bridge } from "../bridges/ports.js";
import { accountRefParts, parseAccountRef, printAccountRef } from "../caip/account-ref.js";
import { type AssetRef, assetRefParts } from "../caip/asset-ref.js";
import { chainRefSchema } from "../caip/chain-ref.js";
import type { TxDraft, TxHash } from "../transaction.js";
import { createFakeChainDefinition } from "./fake-chain.js";
import {
  fakeAmountOf,
  fakeAmountsOf,
  fakeApprovalData,
  fakeCallOf,
  fakeDraft,
} from "./fake-draft.js";

/** A route of the fake bridge: the token that leaves the fake chain and the one that arrives. */
export interface FakeBridgeRoute {
  readonly leaves: AssetRef;
  readonly arrives: AssetRef;
}

/** A fake bridge, whose deposits a test settles by hand. */
export interface FakeBridge extends Bridge {
  /** Sets where the deposit sent in this transaction stands from now on. */
  settle(hash: TxHash, state: DepositState): void;
}

const fakeChainRef = chainRefSchema.parse(createFakeChainDefinition().id);
// Each quote holds a minute from the time the test gives.
const quoteLifetimeMs = 60_000;
// The relayer keeps 1% of the input, and a fill pays the rest.
const keptPerHundred = 99n;

function refuse(code: `${string}.${string}`, message: string): BinferenceError {
  return new BinferenceError({ code, message });
}

function served(routes: readonly FakeBridgeRoute[], request: BridgeQuoteRequest): boolean {
  const { amountIn, deliveredAsset, recipient, cappedAssets } = request;
  return (
    routes.some((route) => route.leaves === amountIn.asset && route.arrives === deliveredAsset) &&
    accountRefParts(recipient).chain === assetRefParts(deliveredAsset).chain &&
    cappedAssets.includes(amountIn.asset)
  );
}

// What a quote was asked, kept as its record, so a build for another request is refused.
function askedOf(request: BridgeQuoteRequest): string {
  const { wallet, amountIn, recipient, deliveredAsset } = request;
  return [wallet, amountIn.asset, amountIn.base, recipient, deliveredAsset].join(" ");
}

function boundData(deposit: Omit<BoundDeposit, "kind" | "depositor" | "contract">): string {
  const { recipient, amountIn, minOut, fillDeadlineMs } = deposit;
  const amounts = [amountIn.base, amountIn.asset, minOut.base, minOut.asset].map(String);
  return ["deposit", recipient, ...amounts, String(fillDeadlineMs)].join(",");
}

// Epoch milliseconds in decimal, up to 16 digits, which a number holds exactly.
const deadlineSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,15})$/)
  .pipe(z.coerce.number<string>());

type DepositWords = Omit<BoundDeposit, "kind" | "depositor" | "contract">;

// The words of a deposit after `deposit`: recipient, amount in, asset in, least out, asset out
// and fill deadline.
function boundOf(words: readonly string[]): DepositWords | undefined {
  const [recipient = "", , , , , deadline = ""] = words;
  const account = parseAccountRef(recipient);
  const amounts = fakeAmountsOf(words);
  const fillDeadlineMs = deadlineSchema.safeParse(deadline);
  return account.ok && amounts !== undefined && fillDeadlineMs.success
    ? { recipient: account.value, ...amounts, fillDeadlineMs: fillDeadlineMs.data }
    : undefined;
}

// An order deposit's words after `order`: its order id, then the amount in and its asset.
function orderOf(words: readonly string[]): Pick<DecodedDeposit, "amountIn"> | undefined {
  const [, base = "", asset = ""] = words;
  const amountIn = fakeAmountOf(base, asset);
  return amountIn === undefined ? undefined : { amountIn };
}

// The deposit a fake call's data writes, without its contract and depositor.
function depositIn(
  data: string,
): DepositWords | Pick<OrderDeposit, "kind" | "amountIn" | "orderId"> | undefined {
  const [kind, ...words] = data.split(",");
  if (kind === "deposit" && words.length === 6) {
    return boundOf(words);
  }
  const order = kind === "order" && words.length === 3 ? orderOf(words) : undefined;
  return order === undefined ? undefined : { kind: "order", ...order, orderId: words[0] ?? "" };
}

function decode(draft: TxDraft): Result<DecodedDeposit, "unknown_call"> {
  const call = fakeCallOf(draft);
  const contract = printAccountRef({ chain: draft.chain, address: call?.to ?? "" });
  const deposit = call === undefined ? undefined : depositIn(call.data);
  if (!contract.ok || deposit === undefined) {
    return err("unknown_call");
  }
  const parties = { contract: contract.value, depositor: draft.from };
  return ok(
    "kind" in deposit ? { ...deposit, ...parties } : { kind: "bound", ...deposit, ...parties },
  );
}

function checkQuote(request: BridgeBuildRequest): void {
  const { quote, minOut } = request;
  if (quote.route !== askedOf(request)) {
    throw refuse("bridge.quote_mismatch", "The quote was given for another request.");
  }
  if (minOut.asset !== quote.minOut.asset || minOut.base > quote.minOut.base) {
    throw refuse("bridge.below_min", "The quote pays less than the least output asked.");
  }
}

function build(request: BridgeBuildRequest, kind: DecodedDeposit["kind"]): readonly TxDraft[] {
  const spoke = request.contracts["spoke"];
  if (spoke === undefined) {
    throw refuse("venue.no_contract", "The fake bridge deposits only through its spoke.");
  }
  checkQuote(request);
  const to = accountRefParts(spoke).address;
  const { wallet, amountIn, recipient, minOut, quote } = request;
  const token = assetRefParts(amountIn.asset).assetReference;
  const approval = { to: token, value: 0n, data: fakeApprovalData(to, amountIn.base) };
  const deposit =
    kind === "bound"
      ? boundData({ recipient, amountIn, minOut, fillDeadlineMs: quote.expiresAtMs })
      : ["order", "fake-order", String(amountIn.base), amountIn.asset].join(",");
  return [fakeDraft(wallet, approval), fakeDraft(wallet, { to, value: 0n, data: deposit })];
}

/** The most a fake settlement names as paid: it names no amount, so a host's read decides. */
const unnamed = 2n ** 256n - 1n;

// A fake fill or refund is the deposit's own when one of its events carries the deposit's hash, as
// a test lands it; a transfer with no such event is never its own.
function settlement(check: SettlementCheck): Result<bigint, "not_own"> {
  const hash = check.deposit.ref.hash.toLowerCase();
  const isOwn = check.settlement.events.some((event) => event.data.toLowerCase().includes(hash));
  return isOwn ? ok(unnamed) : err("not_own");
}

/**
 * A fill the fake bridge takes as its deposit's own, whose event carries the deposit's hash, and
 * the same check with only a bare transfer of the fill's token, which it never takes; for the
 * bridge contract suite.
 */
export function fakeSettlementCases(
  sent: { readonly deposit: DepositRef; readonly fill: DepositRef },
  request: Pick<BridgeQuoteRequest, "wallet" | "amountIn" | "recipient" | "deliveredAsset">,
): {
  readonly settled: { readonly check: SettlementCheck; readonly paid: bigint };
  readonly stranger: SettlementCheck;
} {
  const fillEvent = { emitter: request.recipient, topics: [], data: `filled ${sent.deposit.hash}` };
  const transfer = { emitter: request.recipient, topics: [], data: "transfer" };
  const check: SettlementCheck = {
    kind: "fill",
    deposit: { ref: sent.deposit, events: [] },
    settlement: { ref: sent.fill, events: [transfer, fillEvent] },
    wallet: request.wallet,
    amountIn: request.amountIn,
    recipient: request.recipient,
    minOut: { asset: request.deliveredAsset, base: 1n },
  };
  const stranger = { ...check, settlement: { ...check.settlement, events: [transfer] } };
  return { settled: { check, paid: unnamed }, stranger };
}

/**
 * Creates the `fake-cross` bridge from the fake chain to `fake:2`, for tests. It serves the routes
 * given, only for a capped token that leaves, keeps 1% of the input for the relayer, refuses a
 * build for another request than its quote's or above its least output, builds an exact approval
 * of its `spoke` and then its deposit, `bound` unless `deposits` says `order`, decodes its own
 * deposits honestly, tells each deposit's state as a test settles it, and takes a fill or refund
 * as a deposit's own only when one of its events carries the deposit's hash.
 */
export function createFakeBridge(options: {
  readonly routes: readonly FakeBridgeRoute[];
  /** When every quote is given, epoch milliseconds; 0 when absent. */
  readonly quotedAtMs?: number;
  /** The kind of deposit it builds; `bound` when absent. */
  readonly deposits?: DecodedDeposit["kind"];
}): FakeBridge {
  const states = new Map<TxHash, DepositState>();
  const quotedAtMs = options.quotedAtMs ?? 0;
  const kind = options.deposits ?? "bound";
  return {
    id: "fake-cross",
    contracts: [{ chain: fakeChainRef, names: ["spoke"] }],
    destinations: [{ chain: chainRefSchema.parse("fake:2"), id: "2" }],
    async quote(request, { signal }) {
      signal.throwIfAborted();
      if (!served(options.routes, request)) {
        return await Promise.resolve(err("no_route"));
      }
      const base = (request.amountIn.base * keptPerHundred) / 100n;
      const out = { asset: request.deliveredAsset, base };
      const relayer = { asset: request.amountIn.asset, base: request.amountIn.base - base };
      const fees = [{ kind: "relayer" as const, amount: relayer }];
      const timing = { etaSeconds: 2, quotedAtMs, expiresAtMs: quotedAtMs + quoteLifetimeMs };
      return ok({ expectedOut: out, minOut: out, fees, ...timing, route: askedOf(request) });
    },
    async build(request, { signal }) {
      signal.throwIfAborted();
      return await Promise.resolve(build(request, kind));
    },
    decode,
    async status(deposit, { signal }) {
      signal.throwIfAborted();
      const state = states.get(deposit.hash) ?? { kind: "unseen" };
      return await Promise.resolve({ state, statusUrl: `https://bridge.test/${deposit.hash}` });
    },
    pageOf: (deposit) => `https://bridge.test/${deposit.hash}`,
    settle(hash, state) {
      states.set(hash, state);
    },
    settlement,
  };
}
