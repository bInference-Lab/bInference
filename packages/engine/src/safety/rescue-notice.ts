import { accountRefParts } from "@binference/chain";
import type { IntentRecord } from "../intents/intent-record.js";
import { rescueQuoteDocument } from "../intents/rescue-quote.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";

/** The message key of the notice that announces a confirmed rescue (spec 4, section 4). */
export const rescueNoticeKey = "notice.rescue";

/**
 * The notice that announces on every surface that the owner confirmed a rescue, with the address
 * its card confirmed; `undefined` for a rescue with no quote, which no card confirmed.
 */
export function rescueNotice(record: IntentRecord): EnginePush | undefined {
  if (record.quote === undefined) {
    return undefined;
  }
  const { rescue } = rescueQuoteDocument.decode(record.quote);
  return noticePush({
    key: rescueNoticeKey,
    agent: record.agentId,
    intent: record.id,
    values: { address: accountRefParts(rescue).address },
  });
}
