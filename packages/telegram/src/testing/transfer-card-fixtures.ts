import { bpsSchema } from "@binference/core";
import type { CardFacts } from "@binference/engine";
import { type AssetInfos, assetInfosSchema } from "@binference/protocol";
import { accountRef, assetRef, assetsWith, refs, swapFacts } from "./card-fixtures.js";

/** A base58 account with no checksum, as an address on Solana is written, on a fake chain. */
export const base58Recipient: string = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

/** A checksummed EVM address, as a card shows a saved one, on a fake chain. */
export const checksummedRecipient: string = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";

// The token a bridge to the base58 chain delivers in place of the USDT it sends.
const usdc = assetRef("fake:2/token:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

/** The fixture assets, with the token a bridge to the base58 chain delivers. */
export const transferAssets: AssetInfos = assetInfosSchema.parse({
  ...assetsWith(),
  [usdc]: { symbol: "USDC", name: "USD Coin", decimals: 6, verified: true },
});

const usdt = (units: bigint, cents = 0n) => ({
  asset: refs.usdt,
  base: units * 10n ** 18n + cents * 10n ** 16n,
});

// What every transfer card shares: the agent, the mode, the card's times and no warning.
const shared = {
  agentName: "main",
  isPaper: false,
  hasOutsideContent: false,
  card: swapFacts.card,
  warnings: { hasUnusualName: false, isNewAddress: false },
} as const;

/**
 * A bridge of 20 USDT to a saved base58 address, delivered as another token after a swap, from the
 * agent's bridge wallet (spec 4, section 3.9): the card with every line a bridge shows.
 */
export const solanaBridgeFacts: CardFacts = {
  ...shared,
  action: {
    kind: "bridge",
    amount: usdt(20n),
    chain: "Solana",
    recipient: accountRef(`fake:2:${base58Recipient}`),
    payee: { label: "Cold wallet" },
    minutes: 2,
    details: {
      minOut: { asset: usdc, base: 19_910_000n },
      fees: usdt(0n, 6n),
      venue: "Relay",
      isChecksumless: true,
      otherToken: { sent: refs.usdt, received: usdc },
      swapRateBps: bpsSchema.parse(15),
    },
  },
  roleWallet: { role: "bridge", label: "Bridge" },
  reason: "Moving profits to my Solana wallet",
};

/**
 * A bridge of 20 USDT to the rescue address on an EVM chain, in the same token, from a main
 * wallet: no swap rate, no other token and no checksum line.
 */
export const baseBridgeFacts: CardFacts = {
  ...shared,
  action: {
    kind: "bridge",
    amount: usdt(20n),
    chain: "Base",
    recipient: accountRef(`fake:3:${checksummedRecipient}`),
    payee: { isRescue: true },
    minutes: 1,
    details: {
      minOut: usdt(19n, 97n),
      fees: usdt(0n, 3n),
      venue: "Across",
      isChecksumless: false,
    },
  },
  reason: "Rescue the profits to Base",
};

/**
 * A send of 1 USDT by `.bnb` name to a smart-account wallet the agent never paid, whose reverse
 * record names another name (spec 4, section 3.9; decisions 0306 and 0308).
 */
export const nameSendFacts: CardFacts = {
  ...shared,
  action: {
    kind: "send",
    amount: usdt(1n),
    recipient: accountRef(`fake:1:${checksummedRecipient}`),
    name: { name: "alice.bnb", resolvedAtMs: shared.card.openedAtMs, smartAccount: true },
  },
  warnings: {
    ...shared.warnings,
    isNewAddress: true,
    reverseDiffers: { name: "alice.bnb", other: "bob.bnb" },
  },
  reason: "Paying Alice as you asked",
};

/** A send of 1 USDT to a saved address, named by its address book label. */
export const savedSendFacts: CardFacts = {
  ...shared,
  action: {
    kind: "send",
    amount: usdt(1n),
    recipient: accountRef(`fake:1:${checksummedRecipient}`),
    payee: { label: "Savings" },
  },
  reason: "Moving profits to savings",
};

/** A send of 1 USDT to the rescue address in effect. */
export const rescueSendFacts: CardFacts = {
  ...savedSendFacts,
  action: {
    kind: "send",
    amount: usdt(1n),
    recipient: accountRef(`fake:1:${checksummedRecipient}`),
    payee: { isRescue: true },
  },
};

/** A revoke of a spender's approval for USDT, the spender by its registry name. */
export const revokeFacts: CardFacts = {
  ...shared,
  action: {
    kind: "revokeApproval",
    token: refs.usdt,
    spender: accountRef(`fake:1:${checksummedRecipient}`),
    spenderName: "PancakeSwap v2 router",
  },
  reason: "Cleaning up old approvals",
};
