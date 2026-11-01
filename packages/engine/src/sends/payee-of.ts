import type { AccountRef } from "@binference/chain";
import type { Id } from "@binference/core";
import type { AgentSettings } from "../agents/agent-record.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { rescueQuoteDocument } from "../intents/rescue-quote.js";
import { type SentPayee, sendQuoteDocument } from "../intents/send-quote.js";
import type { IntentStore } from "../ports.js";

// The settled intents of the agent read, a page at a time and at most this many pages, to tell
// whether it ever sent to an address; past them the card says the address is new, which errs on
// the side of the owner's care.
const pageSize = 500;
const maxPages = 20;

// Where a settled send or rescue paid; none for any other intent.
function paidBy(record: IntentRecord): AccountRef | undefined {
  if (record.quote === undefined) {
    return undefined;
  }
  if (record.kind === "send") {
    return sendQuoteDocument.decode(record.quote).recipient;
  }
  return record.kind === "rescue" ? rescueQuoteDocument.decode(record.quote).rescue : undefined;
}

async function hasSentTo(
  intents: Pick<IntentStore, "list">,
  asked: { readonly agentId: Id<"agt">; readonly account: AccountRef; readonly page?: number },
  call: { readonly signal: AbortSignal; readonly after?: IntentRecord },
): Promise<boolean> {
  const { agentId, account, page = 0 } = asked;
  const { after } = call;
  const query = {
    states: ["reconciled" as const],
    agentId,
    isPaper: false,
    limit: pageSize,
    ...(after === undefined ? {} : { after: { changedAtMs: after.changedAtMs, id: after.id } }),
  };
  const records = await intents.list(query, { signal: call.signal });
  if (records.some((record) => paidBy(record) === account)) {
    return true;
  }
  const last = records.at(-1);
  return records.length < pageSize || last === undefined || page + 1 >= maxPages
    ? false
    : hasSentTo(intents, { ...asked, page: page + 1 }, { signal: call.signal, after: last });
}

/**
 * Who a send pays, as its card names them (spec 4, section 3.9): the agent's address book label
 * of the account, whether it is the rescue address in effect, and whether no live send or rescue
 * of the agent that settled paid it, among its latest 10,000 settled intents.
 */
export async function payeeOf(
  intents: Pick<IntentStore, "list">,
  payee: {
    readonly settings: AgentSettings;
    readonly account: AccountRef;
    readonly rescueAccount?: AccountRef;
  },
  signal: AbortSignal,
): Promise<SentPayee> {
  const { settings, account, rescueAccount } = payee;
  const label = settings.addressBook.find((entry) => entry.account === account)?.label;
  const asked = { agentId: settings.agent.id, account };
  const isNew = !(await hasSentTo(intents, asked, { signal }));
  return {
    ...(label === undefined ? {} : { label }),
    ...(account === rescueAccount ? { isRescue: true } : {}),
    ...(isNew ? { isNewRecipient: true } : {}),
  };
}
