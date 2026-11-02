import type {
  AssetInfos,
  CardLineView,
  CardValueView,
  IntentOutcome,
  IntentView,
} from "@binference/protocol";
import type { Formatter } from "../format/create-formatter.js";
import { messages } from "../messages.js";
import { cardLineText } from "./card-text.js";

/**
 * What a reason's words may name: a send's name, a bridge's chain, the intent's wallet, and a
 * staking move's validator, the venue's least stake and when the wallet's next unbonding part is
 * ready, with the infos of the assets an amount is in.
 */
export interface ReasonNames {
  readonly name?: string | undefined;
  readonly chain?: string | undefined;
  readonly wallet?: string | undefined;
  readonly validator?: IntentOutcome["validator"] | undefined;
  readonly minStake?: IntentOutcome["minStake"] | undefined;
  /** When the next part is ready; absent when none waits, which the words say as such. */
  readonly readyAt?: number | undefined;
  readonly assets?: AssetInfos | undefined;
}

/** What an intent's view gives a reason's words to name. */
export function reasonNamesOf(
  view: Pick<IntentView, "wallet" | "outcome" | "resolvedName" | "assets">,
): ReasonNames {
  const { outcome } = view;
  return {
    name: view.resolvedName?.name,
    chain: outcome?.chain,
    wallet: view.wallet,
    validator: outcome?.validator,
    minStake: outcome?.minStake,
    readyAt: outcome?.readyAt,
    assets: view.assets,
  };
}

// A validator as a card names it: its name, cut and escaped as outside text, and its address; its
// address alone when no name is known.
function validatorValue(validator: NonNullable<IntentOutcome["validator"]>): CardValueView {
  const address: CardValueView = { type: "account", account: validator.account };
  return validator.name === undefined
    ? address
    : {
        type: "line",
        line: {
          key: "card.value.validator",
          values: { moniker: { type: "text", text: validator.name }, address },
        },
      };
}

// The values of a reason's words, each in the form its message takes.
function reasonValues(named: ReasonNames): Readonly<Record<string, CardValueView>> {
  const texts = Object.entries({ name: named.name, chain: named.chain, wallet: named.wallet });
  const values: Record<string, CardValueView> = Object.fromEntries(
    texts.flatMap(([field, text]: readonly [string, string | undefined]) =>
      typeof text === "string" ? [[field, { type: "text", text } as const]] : [],
    ),
  );
  const { validator, minStake, readyAt } = named;
  return {
    ...values,
    ...(validator === undefined ? {} : { validator: validatorValue(validator) }),
    ...(minStake === undefined ? {} : { min: { type: "amount", amount: minStake } }),
    readyAt:
      readyAt === undefined
        ? { type: "choice", choice: "none" }
        : { type: "dateTime", atMs: readyAt },
  };
}

/**
 * The receipt of a confirmed intent that ended before anything was sent or filled (spec 4, section
 * 3.5), as plain text in the owner's language, the words Telegram's copy of the card ends with:
 * `receipt.refused` with the reason its code names, or `receipt.unsent` for an intent that stored
 * no code, or one with a code this version has no words for. The words of a reason name what the
 * view gives: a send by name's name, a bridge's destination chain, the intent's wallet, a staking
 * move's validator, least stake and next ready time.
 */
export function unsentReceiptText(
  formatter: Formatter,
  reason: string | undefined,
  named: ReasonNames = {},
): string {
  const key = `reason.${reason ?? ""}`;
  const line: CardLineView = Object.hasOwn(messages.en, key)
    ? {
        key: "receipt.refused",
        values: { reason: { type: "line", line: { key, values: reasonValues(named) } } },
      }
    : { key: "receipt.unsent", values: {} };
  return cardLineText(line, { formatter, assets: named.assets ?? {} });
}
