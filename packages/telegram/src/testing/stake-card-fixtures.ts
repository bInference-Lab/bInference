import { bpsSchema } from "@binference/core";
import type { CardFacts, CardLine, CardValue, IntentReason } from "@binference/engine";
import type { ReceiptAfter } from "@binference/engine/surfaces";
import { createFormatter } from "@binference/i18n";
import { receiptHtml } from "../cards/card-html.js";
import { accountRef, assetsWith, receiptTxHash, refs, swapFacts } from "./card-fixtures.js";
import { parseFakeHtml } from "./fake-html.js";

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

/** The wallet a staking refusal of the fixtures names. */
export const stakeWalletId = "wal_0190f1c2-3a4b-7c5d-8e6f-000000000001";

/** The validator Legend, by its name and address, as a staking refusal names it. */
export const stakeValidatorValue: CardValue = {
  type: "line",
  line: {
    key: "card.value.validator",
    values: {
      moniker: { type: "text", text: "Legend" },
      address: { type: "account", account: validator },
    },
  },
};

/**
 * What a staking refusal's words name, as the engine gives them (decision 0327): the wallet, the
 * validator by its name and address, the venue's least stake of 1 BNB, and the next part ready 7
 * days after the card opened.
 */
const stakeRefusalValues: CardLine["values"] = {
  wallet: { type: "text", text: stakeWalletId },
  validator: stakeValidatorValue,
  min: { type: "amount", amount: bnb(1n) },
  readyAt: { type: "dateTime", atMs: swapFacts.card.openedAtMs + 7 * 86_400_000 },
};

/**
 * The text the owner reads of a confirmed staking card's receipt once its venue refused it with
 * `reason`, in a language: the HTML the bot sends, as Telegram parses it.
 */
export function stakeReceiptText(reason: IntentReason, locale: "en" | "zh"): string {
  return receiptText({ kind: "refused", reason, values: stakeRefusalValues }, locale);
}

/**
 * The text the owner reads of a confirmed unstake's receipt once it landed: 2 BNB out, ready 7
 * days after the card opened, its transaction named by its short hash.
 */
export function unstakedReceiptText(locale: "en" | "zh"): string {
  const readyAtMs = swapFacts.card.openedAtMs + 7 * 86_400_000;
  return receiptText(
    { kind: "unstaked", amount: bnb(2n), readyAtMs, tx: { hash: receiptTxHash } },
    locale,
  );
}

// A confirmed card's receipt, the HTML the bot sends, as Telegram parses it.
function receiptText(after: ReceiptAfter, locale: "en" | "zh"): string {
  const display = { formatter: createFormatter({ locale, timeZone: "UTC" }), assets: assetsWith() };
  const closing = {
    outcome: "confirmed",
    answeredBy: { surface: "telegram", by: "tg:1" },
    atMs: 0,
  } as const;
  const parsed = parseFakeHtml(receiptHtml(closing, display, after));
  if (!parsed.ok) {
    throw new Error(`Telegram refused the receipt's HTML: ${parsed.error}.`);
  }
  return parsed.value.text;
}

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
