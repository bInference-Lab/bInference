import { BinferenceError, err, type JsonValue, ok, type Result } from "@binference/core";
import type { Amount } from "../amount.js";
import { type AccountRef, accountRefParts, printAccountRef } from "../caip/account-ref.js";
import { type AssetRef, assetRefParts, assetRefSchema, parseAssetRef } from "../caip/asset-ref.js";
import type { TxDraft } from "../transaction.js";
import { type LaunchOptionValue, launchOptionValuesSchema } from "../venues/launch-option.js";
import {
  type DecodedLaunch,
  type LaunchBuildRequest,
  type LaunchPinRequest,
  type LaunchTerms,
  type PinStatus,
  type WrittenPicture,
} from "../venues/launch-terms.js";
import { type WrittenWords, writtenWordsOf, writtenWordsSchema } from "../venues/launch-words.js";
import type { Launcher, UploadingLauncher } from "../venues/ports.js";
import { fakeApprovalData, fakeCallOf, fakeDraft, isFakeUnsigned } from "./fake-draft.js";
import { fakePictureOf, fakeWrittenPictureOf } from "./fake-launch-picture.js";
import type { FakeLauncherOptions, FakePinScript } from "./fake-launcher-options.js";

/** A fake launcher, which tells a test what it uploaded and how often its pins were read. */
export interface FakeLauncher extends UploadingLauncher {
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
    word(launch.metadataUri ?? ""),
    launch.pair,
    launch.feeBase.toString(),
    firstBuy?.spend.base.toString() ?? "",
    firstBuy?.minOut.toString() ?? "",
    firstBuy === undefined ? "" : accountRefParts(firstBuy.recipient).address,
    word(JSON.stringify(launch.options)),
    launch.words === undefined ? "" : word(JSON.stringify(launch.words)),
    launch.picture === undefined ? "" : word(JSON.stringify(launch.picture)),
  ].join(",");
}

// The words' word: JSON of the words the call writes, none when empty; undefined when unreadable.
function wordsOf(text: string): { readonly words?: WrittenWords } | undefined {
  if (text === "") {
    return {};
  }
  try {
    const parsed = writtenWordsSchema.safeParse(JSON.parse(decodeURIComponent(text)));
    return parsed.success ? { words: parsed.data } : undefined;
  } catch {
    return undefined;
  }
}

// The settings' word: JSON of each setting by name, which a launch that fails to parse leaves out.
function optionsOf(text: string): Readonly<Record<string, LaunchOptionValue>> | undefined {
  try {
    const parsed = launchOptionValuesSchema.safeParse(JSON.parse(decodeURIComponent(text)));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
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

// The words of a create call after `launch`: token, name, symbol, metadata, pair, fee, the first
// buy's three words, the settings, the words it writes on chain and the picture it writes.
function launchOf(draft: TxDraft, words: readonly string[]): DecodedLaunch | undefined {
  const token = parseAssetRef(wordAt(words, 0));
  const pair = parseAssetRef(wordAt(words, 4));
  const fee = wordAt(words, 5);
  if (words.length !== 12 || !token.ok || !pair.ok || !isFakeUnsigned(fee)) {
    return undefined;
  }
  const bought = firstBuyOf(draft.from, pair.value, words.slice(6, 9));
  const options = optionsOf(wordAt(words, 9));
  const written = wordsOf(wordAt(words, 10));
  const picture = fakePictureOf(wordAt(words, 11));
  const metadataUri = decodeURIComponent(wordAt(words, 3));
  return bought === undefined ||
    options === undefined ||
    written === undefined ||
    picture === undefined
    ? undefined
    : {
        token: token.value,
        name: decodeURIComponent(wordAt(words, 1)),
        symbol: decodeURIComponent(wordAt(words, 2)),
        ...(metadataUri === "" ? {} : { metadataUri }),
        ...picture,
        pair: pair.value,
        feeBase: BigInt(fee),
        ...bought,
        options,
        ...written,
      };
}

function decodeLaunch(draft: TxDraft): Result<DecodedLaunch, "unknown_call"> {
  const [kind, ...words] = fakeCallOf(draft)?.data.split(",") ?? [];
  const launch = kind === "launch" ? launchOf(draft, words) : undefined;
  return launch === undefined ? err("unknown_call") : ok(launch);
}

/** What the fake launchpad writes into a create call beyond its request. */
interface Written {
  readonly token: AssetRef;
  readonly options: Readonly<Record<string, LaunchOptionValue>>;
  readonly minOut: bigint;
  readonly words?: WrittenWords;
  readonly picture?: WrittenPicture;
}

// An exact approval of an ERC-20 first buy's spend, then the create call, which pays the fee and
// a coin first buy as its value.
function buildSteps(request: LaunchBuildRequest, written: Written): readonly TxDraft[] {
  const router = accountRefParts(routerOf(request)).address;
  const { firstBuy, wallet } = request;
  const bought =
    firstBuy === undefined
      ? {}
      : {
          firstBuy: {
            spend: firstBuy,
            minOut: written.minOut,
            recipient: wallet,
          },
        };
  const data = fakeLaunchData({
    token: written.token,
    name: request.name,
    symbol: request.symbol,
    ...(request.metadataUri === undefined ? {} : { metadataUri: request.metadataUri }),
    pair: request.pair,
    feeBase: request.fee.base,
    ...bought,
    options: written.options,
    ...(written.words === undefined ? {} : { words: written.words }),
    ...(written.picture === undefined ? {} : { picture: written.picture }),
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

// The first buy's minimum its create call writes: the request's, none for a launcher that
// declares it carries none, or what the test scripts.
function writtenMinOut(options: FakeLauncherOptions, request: LaunchBuildRequest): bigint {
  const declared = options.noFirstBuyMin === true ? 0n : (request.firstBuyMinOut ?? 0n);
  return options.writesMinOut ?? declared;
}

// What the create call writes beyond the request: the token, the settings, the minimum, the
// picture and, for a launchpad that keeps them on chain, the words, each as the test scripts.
function writtenOf(options: FakeLauncherOptions, request: LaunchBuildRequest): Written {
  const words = options.writesWords ?? writtenWordsOf(request);
  return {
    token: options.token ?? fakeToken,
    options: options.writesOptions ?? request.options,
    minOut: writtenMinOut(options, request),
    ...(options.wordLimits === undefined ? {} : { words }),
    ...fakeWrittenPictureOf(request, options.writesPictureSha256),
  };
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

/** How a fake launcher records an upload and a pin read, each answering its count so far. */
interface PinRecord {
  readonly upload: (request: LaunchPinRequest) => number;
  readonly read: () => number;
}

// The fake's upload and pin status: an upload is kept and named, a pin goes as its script says.
function pinsOf(
  script: FakePinScript,
  record: PinRecord,
): Pick<UploadingLauncher, "pin" | "pinStatus"> {
  return {
    async pin(request, { signal }) {
      signal.throwIfAborted();
      const upload = record.upload(request);
      return await Promise.resolve({
        metadataUri: `ipfs://fake-${String(upload)}`,
        pin: { upload },
      });
    },
    async pinStatus(_pin: JsonValue, { signal }) {
      signal.throwIfAborted();
      return await Promise.resolve(statusOf(script, record.read()));
    },
  };
}

/**
 * Creates the launcher of a fake launchpad, for tests. It launches one token against one pair
 * through the launchpad's `router`, at a fixed fee and a fixed first-buy rate, uploads to nowhere
 * and pins as its script says. Its create call is a fake draft that {@link fakeLaunchData} writes.
 */
export function createFakeLauncher(options: FakeLauncherOptions = {}): FakeLauncher {
  const script = options.pin ?? { pinnedAfterReads: 1 };
  const uploads: LaunchPinRequest[] = [];
  const counted = { reads: 0 };
  const record = {
    upload: (request: LaunchPinRequest) => uploads.push(request),
    read: () => {
      counted.reads += 1;
      return counted.reads;
    },
  };
  return {
    ...createFakeLinkLauncher(options),
    ...pinsOf(script, record),
    uploads: () => [...uploads],
    statusReads: () => counted.reads,
  };
}

/**
 * Creates the launcher of a fake launchpad that uploads nothing and has no pin, as one whose
 * picture is a link setting the owner hosts (decision 0276). It launches as
 * {@link createFakeLauncher} does, with no metadata address in its create call.
 */
export function createFakeLinkLauncher(options: FakeLauncherOptions = {}): Launcher {
  const pair = options.pair ?? fakeCoin;
  const token = options.token ?? fakeToken;
  const tokensPerUnit = options.tokensPerUnit ?? 1000n;
  return {
    launchOptions: options.launchOptions ?? [],
    ...(options.noFirstBuyMin === true ? { noFirstBuyMin: true } : {}),
    ...(options.wordLimits === undefined ? {} : { wordLimits: options.wordLimits }),
    async quoteLaunch(terms, { signal }) {
      signal.throwIfAborted();
      const coin = assetRefSchema.parse(`${accountRefParts(terms.wallet).chain}/slip44:1`);
      const fee: Amount = { asset: coin, base: options.feeBase ?? 2000n };
      if (terms.pair !== pair) {
        return await Promise.resolve(err("no_route"));
      }
      const out =
        terms.firstBuy === undefined ? {} : { firstBuyOut: terms.firstBuy.base * tokensPerUnit };
      const quoted = Object.entries(options.quotesSettings ?? {}).filter(
        ([name]: readonly [string, LaunchOptionValue]) => terms.options[name] === undefined,
      );
      const settings = quoted.length === 0 ? {} : { settings: Object.fromEntries(quoted) };
      return await Promise.resolve(ok({ fee, tokenDecimals: 18, ...out, ...settings }));
    },
    async buildLaunch(request, { signal }) {
      signal.throwIfAborted();
      return await Promise.resolve({
        token,
        steps: buildSteps(request, writtenOf(options, request)),
      });
    },
    decodeLaunch,
  };
}
