import { bpsSchema, BinferenceError, type Id, idSchema } from "@binference/core";
import type { CardFacts, CardValue } from "@binference/engine";
import { type AssetInfo, type AssetInfos, assetInfosSchema } from "@binference/protocol";

type AssetRef = Extract<CardValue, { readonly type: "asset" }>["asset"];
type AccountRef = Extract<CardValue, { readonly type: "account" }>["account"];

function isAssetRef(text: string): text is AssetRef {
  return /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}\/[-a-z0-9]{3,8}:[-.%a-zA-Z0-9]{1,128}$/.test(text);
}

function isAccountRef(text: string): text is AccountRef {
  return /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}:[-.%a-zA-Z0-9]{1,128}$/.test(text);
}

function assetRef(text: string): AssetRef {
  if (!isAssetRef(text)) {
    throw new BinferenceError({ code: "test.bad_fixture", message: `${text} is no asset ref.` });
  }
  return text;
}

/** An account ref for a card fixture; throws for a text that is not one. */
export function accountRef(text: string): AccountRef {
  if (!isAccountRef(text)) {
    throw new BinferenceError({ code: "test.bad_fixture", message: `${text} is no account ref.` });
  }
  return text;
}

/** The fake chain's coin, a verified stablecoin and an unverified token at a real-looking address. */
export const refs: { readonly bnb: AssetRef; readonly usdt: AssetRef; readonly pepe: AssetRef } = {
  bnb: assetRef("fake:1/slip44:1"),
  usdt: assetRef("fake:1/erc20:0x55d398326f99059fF775485246999027B3197955"),
  pepe: assetRef("fake:1/erc20:0x6982508145454Ce325dDbE47a25d4ec3d2311933"),
};

const known: Readonly<Record<string, AssetInfo>> = {
  [refs.bnb]: { symbol: "BNB", name: "BNB", decimals: 18, verified: true },
  [refs.usdt]: { symbol: "USDT", name: "Tether USD", decimals: 18, verified: true },
  [refs.pepe]: { symbol: "PEPE", name: "Pepe", decimals: 18, verified: false },
};

/** The infos of the fixture assets; `pepe` may take another symbol and name. */
export function assetsWith(pepe?: Partial<AssetInfo>): AssetInfos {
  return assetInfosSchema.parse({ ...known, [refs.pepe]: { ...known[refs.pepe], ...pepe } });
}

/** The intent the fixture cards confirm. */
export const cardIntent: Id<"int"> = idSchema("int").parse(
  "int_0190f1c2-3a4b-7c5d-8e6f-000000000001",
);

/** 14:32:05 UTC on the day of the spec's example card. */
export const cardExpiresAtMs: number = Date.UTC(2026, 9, 6, 14, 32, 5);

/** The swap card of spec 4, section 3.2. */
export const swapFacts: CardFacts = {
  agentName: "main",
  isPaper: false,
  hasOutsideContent: false,
  card: { version: 1, openedAtMs: cardExpiresAtMs - 60_000, expiresAtMs: cardExpiresAtMs },
  action: {
    kind: "swap",
    amountIn: { asset: refs.bnb, base: 5n * 10n ** 17n },
    minOut: { asset: refs.usdt, base: 31_240n * 10n ** 16n },
  },
  route: {
    venue: "KyberSwap",
    legs: [
      { venue: "PancakeSwap v3", shareBps: bpsSchema.parse(9_200) },
      { venue: "Infinity", shareBps: bpsSchema.parse(800) },
    ],
    priceImpactBps: bpsSchema.parse(8),
    maxSlippageBps: bpsSchema.parse(50),
  },
  fees: { networkFeeUsdMicros: 4_000n, isPrivateSend: true },
  check: {
    received: { asset: refs.usdt, base: 31_395n * 10n ** 16n },
    token: refs.usdt,
    isTokenVerified: true,
  },
  warnings: { hasUnusualName: false, isNewAddress: false },
  reason: "Taking profit as you asked at $625",
};

/** A buy of the unverified fixture token with BNB, whatever that token calls itself. */
export const pepeBuyFacts: CardFacts = {
  ...swapFacts,
  action: {
    kind: "swap",
    amountIn: { asset: refs.bnb, base: 10n ** 17n },
    minOut: { asset: refs.pepe, base: 10n ** 24n },
  },
  check: {
    received: { asset: refs.pepe, base: 10n ** 24n },
    token: refs.pepe,
    isTokenVerified: false,
  },
};
