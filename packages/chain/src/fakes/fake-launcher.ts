import { BinferenceError, err, type JsonValue, ok, type Result } from "@binference/core";
import type { Amount } from "../amount.js";
import { type AccountRef, accountRefParts, printAccountRef } from "../caip/account-ref.js";
import { type AssetRef, assetRefParts, assetRefSchema, parseAssetRef } from "../caip/asset-ref.js";
import type { TxDraft } from "../transaction.js";
import type { LaunchOption } from "../venues/launch-option.js";
import type {
  DecodedLaunch,
  LaunchBuildRequest,
  LaunchPinRequest,
  LaunchTerms,
  PinStatus,
} from "../venues/launch-terms.js";
import type { Launcher } from "../venues/ports.js";
import { fakeApprovalData, fakeCallOf, fakeDraft, isFakeUnsigned } from "./fake-draft.js";

/** How a fake launchpad's pins go: pinned after some status reads, never, or failed. */
export type FakePinScript =
  | { readonly pinnedAfterReads: number }
  | { readonly never: true }
  | { readonly failsAfterReads: number };

/** What a fake launcher launches against, charges and makes. */
export interface FakeLauncherOptions {
  /** The asset its launches trade against; the fake chain's coin when absent. */
  readonly pair?: AssetRef;
  /** Its launch fee, in base units of the fake chain's coin; 2,000 when absent. */
  readonly feeBase?: bigint;
  /** The token every launch makes; `fake:1/token:0x000000e1` when absent. */
  readonly token?: AssetRef;
  /** Base units of the new token a first buy gets per base unit it spends; 1,000 when absent. */
  readonly tokensPerUnit?: bigint;
  /** How its pins go; pinned at the first status read when absent. */
  readonly pin?: FakePinScript;
  /** The settings it declares; none when absent. */
  readonly launchOptions?: readonly LaunchOption[];
}

/** A fake launcher, which tells a test what it uploaded and how often its pins were read. */
export interface FakeLauncher extends Launcher {
  /** Every upload it took, in order. */
  readonly uploads: () => readonly LaunchPinRequest[];
  /** How many times a pin's status was read. */
  readonly statusReads: () => number;
}

const fakeCoin = assetRefSchema.parse("fake:1/slip44:1");
const fakeToken = assetRefSchema.parse("fake:1/token:0x000000e1");

function isCoin(asset: AssetRef): boolean {
  return asset === `${assetRefParts(asset).chain}/slip44:1`;
}

function routerOf(terms: LaunchTerms): AccountRef {
  const router = terms.contracts["router"];
  if (router === undefined) {
    throw new BinferenceError({
      code: "venue.no_contract",
      message: "The fake launchpad launches only through its router.",
    });
  }
  return router;
}

// A fake call's words hold no comma or bar, so free text is percent-encoded.
const word = (text: string): string => encodeURIComponent(text);

/** The data of a fake launchpad's create call, which its decoder reads back. */
export function fakeLaunchData(launch: DecodedLaunch): string {
  const { firstBuy } = launch;
  return [
    "launch",
    launch.token,
    word(launch.name),
    word(launch.symbol),
    word(launch.metadataUri),
    launch.pair,
    launch.feeBase.toString(),
    firstBuy?.spend.base.toString() ?? "",
    firstBuy?.minOut.toString() ?? "",
    firstBuy === undefined ? "" : accountRefParts(firstBuy.recipient).address,
  ].join(",");
}

// The first buy's words: its spend, its minimum out and its recipient, all empty for none.
function firstBuyOf(from: AccountRef, pair: AssetRef, words: readonly string[]) {
  const [spend = "", minOut = "", recipient = ""] = words;
  if (spend === "") {
    return minOut === "" && recipient === "" ? {} : undefined;
  }
  const account = printAccountRef({ chain: accountRefParts(from).chain, address: recipient });
  return isFakeUnsigned(spend) && isFakeUnsigned(minOut) && account.ok
    ? {
        firstBuy: {
          spend: { asset: pair, base: BigInt(spend) },
          minOut: BigInt(minOut),
          recipient: account.value,
        },
      }
    : undefined;
}

const wordAt = (words: readonly string[], index: number): string => words[index] ?? "";

// The words of a create call after `launch`: token, name, symbol, metadata, pair, fee and the
// first buy's three words.
function launchOf(draft: TxDraft, words: readonly string[]): DecodedLaunch | undefined {
  const token = parseAssetRef(wordAt(words, 0));
  const pair = parseAssetRef(wordAt(words, 4));
  const fee = wordAt(words, 5);
  if (words.length !== 9 || !token.ok || !pair.ok || !isFakeUnsigned(fee)) {
    return undefined;
  }
  const bought = firstBuyOf(draft.from, pair.value, words.slice(6));
  return bought === undefined
    ? undefined
    : {
        token: token.value,
        name: decodeURIComponent(wordAt(words, 1)),
        symbol: decodeURIComponent(wordAt(words, 2)),
        metadataUri: decodeURIComponent(wordAt(words, 3)),
        pair: pair.value,
        feeBase: BigInt(fee),
        ...bought,
      };
}

function decodeLaunch(draft: TxDraft): Result<DecodedLaunch, "unknown_call"> {
  const [kind, ...words] = fakeCallOf(draft)?.data.split(",") ?? [];
  const launch = kind === "launch" ? launchOf(draft, words) : undefined;
  return launch === undefined ? err("unknown_call") : ok(launch);
}

// An exact approval of an ERC-20 first buy's spend, then the create call, which pays the fee and
// a coin first buy as its value.
function buildSteps(request: LaunchBuildRequest, token: AssetRef): readonly TxDraft[] {
  const router = accountRefParts(routerOf(request)).address;
  const { firstBuy, wallet } = request;
  const bought =
    firstBuy === undefined
      ? {}
      : {
          firstBuy: {
            spend: firstBuy,
            minOut: request.firstBuyMinOut ?? 0n,
            recipient: wallet,
          },
        };
  const data = fakeLaunchData({
    token,
    name: request.name,
    symbol: request.symbol,
    metadataUri: request.metadataUri,
    pair: request.pair,
    feeBase: request.fee.base,
    ...bought,
  });
  const coinSpend = firstBuy !== undefined && isCoin(firstBuy.asset) ? firstBuy.base : 0n;
  const create = fakeDraft(wallet, { to: router, value: request.fee.base + coinSpend, data });
  if (firstBuy === undefined || isCoin(firstBuy.asset)) {
    return [create];
  }
  const approval = fakeDraft(wallet, {
    to: assetRefParts(firstBuy.asset).assetReference,
    value: 0n,
    data: fakeApprovalData(router, firstBuy.base),
  });
  return [approval, create];
}

function statusOf(script: FakePinScript, reads: number): PinStatus {
  if ("never" in script) {
    return "pending";
  }
  if ("failsAfterReads" in script) {
    return reads >= script.failsAfterReads ? "failed" : "pending";
  }
  return reads >= script.pinnedAfterReads ? "pinned" : "pending";
}

/**
 * Creates the launcher of a fake launchpad, for tests. It launches one token against one pair
 * through the launchpad's `router`, at a fixed fee and a fixed first-buy rate, uploads to nowhere
 * and pins as its script says. Its create call is a fake draft that {@link fakeLaunchData} writes.
 */
export function createFakeLauncher(options: FakeLauncherOptions = {}): FakeLauncher {
  const pair = options.pair ?? fakeCoin;
  const token = options.token ?? fakeToken;
  const tokensPerUnit = options.tokensPerUnit ?? 1000n;
  const script = options.pin ?? { pinnedAfterReads: 1 };
  const uploads: LaunchPinRequest[] = [];
  const counted = { reads: 0 };
  return {
    launchOptions: options.launchOptions ?? [],
    async quoteLaunch(terms, { signal }) {
      signal.throwIfAborted();
      const coin = assetRefSchema.parse(`${accountRefParts(terms.wallet).chain}/slip44:1`);
      const fee: Amount = { asset: coin, base: options.feeBase ?? 2000n };
      if (terms.pair !== pair) {
        return await Promise.resolve(err("no_route"));
      }
      const out =
        terms.firstBuy === undefined ? {} : { firstBuyOut: terms.firstBuy.base * tokensPerUnit };
      return await Promise.resolve(ok({ fee, tokenDecimals: 18, ...out }));
    },
    async pin(request, { signal }) {
      signal.throwIfAborted();
      uploads.push(request);
      const upload = uploads.length;
      return await Promise.resolve({
        metadataUri: `ipfs://fake-${String(upload)}`,
        pin: { upload },
      });
    },
    async pinStatus(_pin: JsonValue, { signal }) {
      signal.throwIfAborted();
      counted.reads += 1;
      return await Promise.resolve(statusOf(script, counted.reads));
    },
    async buildLaunch(request, { signal }) {
      signal.throwIfAborted();
      return await Promise.resolve({ token, steps: buildSteps(request, token) });
    },
    decodeLaunch,
    uploads: () => [...uploads],
    statusReads: () => counted.reads,
  };
}
