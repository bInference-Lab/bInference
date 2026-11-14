import { parseMessage } from "../check/parse-message.js";
import type { Formatter } from "../format/create-formatter.js";
import { messages } from "../messages.js";

// An argument's name, from its form as the parser writes it: `{used}`, `{count, plural}`, `<b>`.
const argumentName = /^[{<]([^,}>]+)/u;

/**
 * A reason code's words alone, for a list that keeps only the code, such as what each alert of an
 * alert rule became; `undefined` for a code this version has no words for, and for one whose words
 * name a value, such as `daily_cap`'s amounts, that `values` does not hold: the intent's own
 * history says those. `values` are the reason's values as text, such as an order's skip keeps
 * them.
 */
export function reasonText(
  formatter: Formatter,
  reason: string,
  values: Readonly<Record<string, string>> = {},
): string | undefined {
  const key = `reason.${reason}`;
  const english = Object.hasOwn(messages.en, key) ? messages.en[key] : undefined;
  const parsed = english === undefined ? undefined : parseMessage(english);
  const isComplete =
    parsed?.ok === true &&
    parsed.value.arguments.every((form) =>
      Object.hasOwn(values, argumentName.exec(form)?.[1] ?? form),
    );
  return isComplete ? formatter.message(key, values) : undefined;
}
