import {
  BinferenceError,
  bpsSchema,
  err,
  mulDiv,
  ok,
  type Ratio,
  type Result,
} from "@binference/core";
import { z } from "zod";
import type { Amount } from "../amount.js";
import { type AccountRef, accountRefParts, printAccountRef } from "../caip/account-ref.js";
import { assetRefParts, parseAssetRef, printAssetRef } from "../caip/asset-ref.js";
import { type ChainRef, chainRefSchema } from "../caip/chain-ref.js";
import type { TxDraft } from "../transaction.js";
import type { BuildRequest } from "../venues/build-request.js";
import type { DecodedEffect } from "../venues/decoded-effect.js";
import type { Venue } from "../venues/venue.js";
import { createFakeChainDefinition } from "./fake-chain.js";
import { fakeApprovalData, fakeCallOf, fakeDraft, isFakeUnsigned } from "./fake-draft.js";

/** What a fake venue quotes at. */
export interface FakeVenueOptions {
  /** Base units out per base unit in; 2 to 1 when absent. */
  readonly rate?: Ratio;
}

const fakeChain = createFakeChainDefinition();
const fakeChainRef = chainRefSchema.parse(fakeChain.id);
const priceImpactBps = bpsSchema.parse(10);

// Epoch milliseconds in decimal, up to 16 digits, which a number holds exactly.
const deadlineSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,15})$/)
  .pipe(z.coerce.number<string>());

// The fake chain's own coin, which the fake venue spends without an approval.
function isNative(amount: Amount): boolean {
  const native = printAssetRef({
    chain: assetRefParts(amount.asset).chain,
    assetNamespace: fakeChain.nativeAsset.assetNamespace,
    assetReference: fakeChain.nativeAsset.assetReference,
  });
  return native.ok && native.value === amount.asset;
}

/** The data of a fake venue's trade call, which its decoder reads back. */
export function fakeSwapData(effect: DecodedEffect): string {
  const { recipient, amountIn, minOut, deadlineMs } = effect;
  return [
    "swap",
    accountRefParts(recipient).address,
    amountIn.base.toString(),
    amountIn.asset,
    minOut.base.toString(),
    minOut.asset,
    String(deadlineMs),
  ].join(",");
}

function amountOf(base: string, asset: string): Amount | undefined {
  const parsed = parseAssetRef(asset);
  return parsed.ok && isFakeUnsigned(base)
    ? { asset: parsed.value, base: BigInt(base) }
    : undefined;
}

interface FakeAmounts {
  readonly amountIn: Amount;
  readonly minOut: Amount;
}

// The words of a trade call after `swap`: recipient, amount in, asset in, minimum out, asset out
// and deadline.
function amountsOf(words: readonly string[]): FakeAmounts | undefined {
  const [, inBase = "", inAsset = "", outBase = "", outAsset = ""] = words;
  const amountIn = amountOf(inBase, inAsset);
  const minOut = amountOf(outBase, outAsset);
  return amountIn === undefined || minOut === undefined ? undefined : { amountIn, minOut };
}

function effectOf(chain: ChainRef, words: readonly string[]): DecodedEffect | undefined {
  const [address = "", , , , , deadline = ""] = words;
  const recipient = printAccountRef({ chain, address });
  const amounts = amountsOf(words);
  const deadlineMs = deadlineSchema.safeParse(deadline);
  if (!recipient.ok || amounts === undefined || !deadlineMs.success) {
    return undefined;
  }
  return { recipient: recipient.value, ...amounts, deadlineMs: deadlineMs.data };
}

function decode(draft: TxDraft): Result<DecodedEffect, "unknown_call"> {
  const [kind, ...words] = fakeCallOf(draft)?.data.split(",") ?? [];
  const effect = kind === "swap" && words.length === 6 ? effectOf(draft.chain, words) : undefined;
  return effect === undefined ? err("unknown_call") : ok(effect);
}

function routerOf(request: BuildRequest): AccountRef {
  const router = request.contracts["router"];
  if (router === undefined) {
    throw new BinferenceError({
      code: "venue.no_contract",
      message: "The fake venue builds only through its router.",
    });
  }
  return router;
}

function build(request: BuildRequest): readonly TxDraft[] {
  const router = accountRefParts(routerOf(request)).address;
  const effect = { ...request, recipient: request.wallet };
  const swap = fakeDraft(request.wallet, {
    to: router,
    value: isNative(request.amountIn) ? request.amountIn.base : 0n,
    data: fakeSwapData(effect),
  });
  if (isNative(request.amountIn)) {
    return [swap];
  }
  const token = assetRefParts(request.amountIn.asset).assetReference;
  const approval = fakeDraft(request.wallet, {
    to: token,
    value: 0n,
    data: fakeApprovalData(router, request.amountIn.base),
  });
  return [approval, swap];
}

/**
 * Creates the `fake-swap` venue of the fake chain, for tests. It quotes at a fixed rate, answers
 * a pair of one asset as `no_route`, builds an exact approval for a token input and then its
 * trade call through its `router`, and decodes its own trade calls honestly.
 */
export function createFakeVenue(options: FakeVenueOptions = {}): Venue {
  const rate = options.rate ?? { numerator: 2n, denominator: 1n };
  return {
    id: "fake-swap",
    contracts: [{ chain: fakeChainRef, names: ["router"] }],
    async quote(request, { signal }) {
      signal.throwIfAborted();
      const expectedOut = {
        asset: request.assetOut,
        base: mulDiv(request.amountIn.base, rate, "down"),
      };
      return await Promise.resolve(
        request.amountIn.asset === request.assetOut
          ? err("no_route")
          : ok({ expectedOut, priceImpactBps }),
      );
    },
    async build(request, { signal }) {
      signal.throwIfAborted();
      return await Promise.resolve(build(request));
    },
    decode,
  };
}
