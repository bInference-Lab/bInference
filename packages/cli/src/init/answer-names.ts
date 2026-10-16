import { initVariablePrefix } from "../config/layers/env-layer.js";

/** Every answer `binference init` takes from a flag, a `BINFERENCE_INIT_*` variable or a file. */
export type AnswerKey =
  | "privyAppId"
  | "privyAppSecret"
  | "botToken"
  | "rescue"
  | "ownerKeyPublic"
  | "unlock"
  | "unlockCommand"
  | "modelProvider"
  | "modelBaseUrl"
  | "model"
  | "modelKey"
  | "acceptDisclaimer";

/**
 * What an answer holds: plain text, a secret source (never the secret itself), the program that
 * prints the agent key, or a yes or no.
 */
type AnswerKind = "text" | "secret" | "command" | "switch";

/** One answer's three names: its key in the answers file, its flag and its variable. */
export interface AnswerName {
  /** The key in the answers file, as the flag's name in camel case: `privyAppId`. */
  readonly key: AnswerKey;
  /** Such as `--privy-app-id`. */
  readonly flag: string;
  /** Such as `BINFERENCE_INIT_PRIVY_APP_ID`. */
  readonly variable: string;
  readonly kind: AnswerKind;
}

/** Where an answer came from: a flag, a `BINFERENCE_INIT_*` variable or the answers file. */
export type AnswerOrigin =
  | { readonly layer: "flag" }
  | { readonly layer: "variable"; readonly name: string }
  | { readonly layer: "file"; readonly file: string };

/** The variable that names the answers file, as `--answers` does. */
export const answersFileVariable: string = `${initVariablePrefix}ANSWERS`;

function named(key: AnswerKey, kind: AnswerKind): AnswerName {
  const words = key.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
  const variable = `${initVariablePrefix}${words.replaceAll("-", "_").toUpperCase()}`;
  return { key, flag: `--${words}`, variable, kind };
}

/** Every answer init takes without a person, in the order of the onboarding. */
export const answerNames: readonly AnswerName[] = [
  named("acceptDisclaimer", "switch"),
  named("modelProvider", "text"),
  named("modelBaseUrl", "text"),
  named("model", "text"),
  named("modelKey", "secret"),
  named("privyAppId", "text"),
  named("privyAppSecret", "secret"),
  named("ownerKeyPublic", "text"),
  named("rescue", "text"),
  named("botToken", "secret"),
  named("unlock", "text"),
  named("unlockCommand", "command"),
];

/** The names of the answer a flag gives, such as `--rescue`; none for any other flag. */
export function answerOfFlag(flag: string): AnswerName | undefined {
  return answerNames.find((answer) => answer.flag === flag);
}
