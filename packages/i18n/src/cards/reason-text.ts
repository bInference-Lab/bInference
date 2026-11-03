import { parseMessage } from "../check/parse-message.js";
import type { Formatter } from "../format/create-formatter.js";
import { messages } from "../messages.js";

/**
 * A reason code's words alone, for a list that keeps only the code, such as what each alert of an
 * alert rule became; `undefined` for a code this version has no words for, and for one whose words
 * name a value, such as `daily_cap`'s amounts, which the list does not hold: the intent's own
 * history says those.
 */
export function reasonText(formatter: Formatter, reason: string): string | undefined {
  const key = `reason.${reason}`;
  const english = Object.hasOwn(messages.en, key) ? messages.en[key] : undefined;
  const parsed = english === undefined ? undefined : parseMessage(english);
  return parsed?.ok === true && parsed.value.arguments.length === 0
    ? formatter.message(key)
    : undefined;
}
