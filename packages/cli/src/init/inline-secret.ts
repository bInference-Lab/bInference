import JSON5 from "json5";
import { isJsonObject, jsonValueSchema } from "../config/json-value.schema.js";
import { initVariablePrefix } from "../config/layers/env-layer.js";
import type { AnswerName } from "./answer-names.js";
import { type Refused, refused } from "./init-context.js";

// Whether a text is written as an object, as a secret source is: anything else is the secret
// itself, or text that holds it.
function isObjectText(text: string): boolean {
  try {
    const parsed = jsonValueSchema.safeParse(JSON5.parse(text));
    return parsed.success && isJsonObject(parsed.data);
  } catch {
    return false;
  }
}

/**
 * Init's refusal `config.secret_inline` for a secret answer written as plain text, the secret
 * itself, rather than as a secret source (decision 0225); none for an object. The refusal names
 * the answer as `name` and shows a source to use, such as `{ fromEnv: "BOT_TOKEN" }` for the
 * bot token, never the text.
 */
export function inlineSecretRefusal(
  name: string,
  answer: Pick<AnswerName, "variable">,
  text: string,
): Refused | undefined {
  if (isObjectText(text)) {
    return undefined;
  }
  const variable = answer.variable.slice(initVariablePrefix.length);
  const example = `{ fromEnv: "${variable}" }`;
  return refused("config.secret_inline", "refused.secretInline", { name, example });
}
