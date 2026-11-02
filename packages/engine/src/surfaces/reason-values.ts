import type { CardLine, CardValue } from "../confirmations/card-line.js";
import { validatorValue } from "../confirmations/stake-card-lines.js";
import { bridgeQuoteDocument } from "../intents/bridge-quote.js";
import type { ReasonNamed } from "../intents/event-cause.schema.js";
import { requestDocument } from "../intents/intent-documents.schema.js";
import { type IntentHistory, reasonNamedOf } from "../intents/intent-history.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { sendQuoteDocument } from "../intents/send-quote.js";
import { stakeQuoteDocument } from "../intents/stake-quote.js";

const text = (value: string) => ({ type: "text", text: value }) as const;

type Named = Pick<IntentRecord, "kind" | "quote" | "walletId"> &
  Partial<Pick<IntentRecord, "request">>;

// A staking move's validator, by its name once a plan named it, else by its account alone; a
// liquid venue's pool a refusal named stands where a request names none (decision 0331).
function validatorOf(record: Named, named: ReasonNamed | undefined): CardValue | undefined {
  if (record.quote !== undefined) {
    const { plan } = stakeQuoteDocument.decode(record.quote);
    return validatorValue({ validator: plan.validator, validatorName: plan.validatorName });
  }
  const request = record.request === undefined ? undefined : requestDocument.decode(record.request);
  if (request?.kind === "stake" && request.validator !== undefined) {
    return validatorValue({ validator: request.validator });
  }
  const { pool } = named ?? {};
  return pool === undefined
    ? undefined
    : validatorValue({
        validator: pool.account,
        ...(pool.name === undefined ? {} : { validatorName: pool.name }),
      });
}

// What a staking move's refusal names (decision 0327): the validator, the venue's least stake and
// when the wallet's next part is ready, `none` when no part waits.
function stakeValuesOf(record: Named, history?: IntentHistory): CardLine["values"] {
  const named = history === undefined ? undefined : reasonNamedOf(history);
  const validator = validatorOf(record, named);
  const { minStake, readyAtMs } = named ?? {};
  const readyAt: CardValue =
    readyAtMs === undefined
      ? { type: "choice", choice: "none" }
      : { type: "dateTime", atMs: readyAtMs };
  return {
    ...(validator === undefined ? {} : { validator }),
    ...(minStake === undefined ? {} : { min: { type: "amount", amount: minStake } }),
    readyAt,
  };
}

/**
 * What the words of an intent's reason may name (spec 4, section 6), from its stored quote, its
 * request and the move that ended it: the intent's wallet, a send by name's name (decision 0308),
 * a bridge's destination chain as the registry names it (decision 0319), and a staking move's
 * validator, the venue's least stake and when the wallet's next unbonding part is ready (decision
 * 0327). A reason's message uses the values it names and leaves the others, so a surface fills
 * every reason of the intent with these.
 */
export function reasonValuesOf(record: Named, history?: IntentHistory): CardLine["values"] {
  const { kind, quote, walletId } = record;
  const wallet = { wallet: text(walletId) };
  if (kind === "stake") {
    return { ...wallet, ...stakeValuesOf(record, history) };
  }
  if (quote === undefined) {
    return wallet;
  }
  if (kind === "bridge") {
    return { ...wallet, chain: text(bridgeQuoteDocument.decode(quote).chainName) };
  }
  const name = kind === "send" ? sendQuoteDocument.decode(quote).name?.name : undefined;
  return name === undefined ? wallet : { ...wallet, name: text(name) };
}
