import { bpsSchema } from "@binference/core";
import type { CardFacts, CardLine, CardValue, IntentReason } from "@binference/engine";
import type { LiveOutcome, ReceiptAfter } from "@binference/engine/surfaces";
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

// What the validator keeps. Only a stake's card has a yearly rate: the engine leaves it out of an
// unstake's and a claim's.
const details = { commissionBps: bpsSchema.parse(700) } as const;
const dayMs = 86_400_000;

/** A stake of 2 BNB with a named validator, its commission and its yearly rate (spec 4, 3.9). */
export const stakeFacts: CardFacts = {
  ...shared,
  action: {
    kind: "stake",
    action: "stake",
    amount: bnb(2n),
    validator,
    validatorName: "Legend",
    details: { ...details, aprBps: 350 },
  },
};

/**
 * A stake of 1 BNB with a validator the venue knows no name for, from a venue that gives no
 * yearly rate: the card names the validator by its address alone and shows no rate.
 */
export const unnamedStakeFacts: CardFacts = {
  ...shared,
  action: { kind: "stake", action: "stake", amount: bnb(1n), validator, details },
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
    details: { ...details, readyAtMs: swapFacts.card.openedAtMs + 7 * dayMs },
  },
};

/**
 * An unstake of 1 BNB that auto mode asked the owner about, ready 1 day after the card opened,
 * from a validator whose name holds markup and a character that turns text around.
 */
export const askedUnstakeFacts: CardFacts = {
  ...shared,
  warnings: { ...shared.warnings, autoAsk: { code: "unstake" } },
  action: {
    kind: "stake",
    action: "unstake",
    amount: bnb(1n),
    validator,
    validatorName: "<b>Legend</b>\u{202E}",
    readyInDays: 1,
    details: { ...details, readyAtMs: swapFacts.card.openedAtMs + dayMs },
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

// What every staking refusal names: the wallet, and the next part ready 7 days after the card opened.
const walletAndReady: CardLine["values"] = {
  wallet: { type: "text", text: stakeWalletId },
  readyAt: { type: "dateTime", atMs: swapFacts.card.openedAtMs + 7 * dayMs },
};

/**
 * What a staking refusal's words name, as the engine gives them (decision 0327): the wallet, the
 * validator by its name and address, the venue's least stake of 1 BNB, and the next part ready 7
 * days after the card opened.
 */
const stakeRefusalValues: CardLine["values"] = {
  ...walletAndReady,
  validator: stakeValidatorValue,
  min: { type: "amount", amount: bnb(1n) },
};

/**
 * What a staking refusal's words name when the venue knows no name for the validator and no part
 * waits to be ready: the validator by its address alone, and the next ready time as none.
 */
export const unnamedStakeRefusalValues: CardLine["values"] = {
  ...stakeRefusalValues,
  validator: { type: "account", account: validator },
  readyAt: { type: "choice", choice: "none" },
};

/**
 * What a staking refusal's words name at their longest when the owner presses its card: the
 * wallet, the validator by a name longer than a card shows, which it cuts to 32 characters, and
 * its address, and the next part's ready time. An open card's history names no least stake, so
 * a press names none.
 */
export const longStakeRefusalValues: CardLine["values"] = {
  ...walletAndReady,
  validator: {
    type: "line",
    line: {
      key: "card.value.validator",
      values: {
        moniker: { type: "text", text: "A validator whose moniker is far too long" },
        address: { type: "account", account: validator },
      },
    },
  },
};

/**
 * The text the owner reads of a confirmed staking card's receipt once its venue refused it with
 * `reason`, in a language, its words naming `values`: the HTML the bot sends, as Telegram parses
 * it.
 */
export function stakeReceiptText(
  reason: IntentReason,
  locale: "en" | "zh",
  values: CardLine["values"] = stakeRefusalValues,
): string {
  return receiptText({ kind: "refused", reason, values }, locale);
}

/**
 * The text the owner reads of a confirmed unstake's receipt once it landed: 2 BNB out, ready 7
 * days after the card opened, its transaction named by its short hash.
 */
export function unstakedReceiptText(locale: "en" | "zh"): string {
  const readyAtMs = swapFacts.card.openedAtMs + 7 * dayMs;
  return receiptText(
    { kind: "unstaked", amount: bnb(2n), readyAtMs, tx: { hash: receiptTxHash } },
    locale,
  );
}

/**
 * A landed unstake as the engine settles its card: 2 BNB out, ready 7 days after the card opened,
 * its transaction linked on the chain's explorer.
 */
export const unstakedOutcome: LiveOutcome = {
  kind: "unstaked",
  amount: bnb(2n),
  readyAtMs: swapFacts.card.openedAtMs + 7 * dayMs,
  tx: { explorerLink: `https://bscscan.com/tx/${receiptTxHash}` },
};

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
