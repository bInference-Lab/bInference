import { bpsSchema } from "@binference/core";
import type { CardFacts } from "@binference/engine";
import { accountRef, refs, swapFacts } from "./card-fixtures.js";

const validator = accountRef("fake:1:0x71C7656EC7ab88b098defB751B7401B5f6d8976F");
const bnb = (units: bigint) => ({ asset: refs.bnb, base: units * 10n ** 18n });

// What every staking card shares: the agent, the mode, the card's times, no warning, the reason.
const shared = {
  agentName: "main",
  isPaper: false,
  hasOutsideContent: false,
  card: swapFacts.card,
  warnings: { hasUnusualName: false, isNewAddress: false },
  reason: "Earn on idle BNB",
} as const;

const details = { commissionBps: bpsSchema.parse(700), aprBps: 350 } as const;

/** A stake of 2 BNB with a named validator, its commission and its yearly rate (spec 4, 3.9). */
export const stakeFacts: CardFacts = {
  ...shared,
  action: {
    kind: "stake",
    action: "stake",
    amount: bnb(2n),
    validator,
    validatorName: "Legend",
    details,
  },
};

/**
 * An unstake of 2 BNB from the same validator, its coin ready 7 days after the card opened, at
 * 14:31:05 UTC.
 */
export const unstakeFacts: CardFacts = {
  ...shared,
  action: {
    kind: "stake",
    action: "unstake",
    amount: bnb(2n),
    validator,
    validatorName: "Legend",
    readyInDays: 7,
    details: { ...details, readyAtMs: swapFacts.card.openedAtMs + 7 * 86_400_000 },
  },
};

/** A claim of 2 BNB from the same validator, whose name is longer than a card shows. */
export const claimFacts: CardFacts = {
  ...shared,
  action: {
    kind: "stake",
    action: "claim",
    amount: bnb(2n),
    validator,
    validatorName: "A validator whose moniker is far too long",
    details,
  },
};
