import type { Ok } from "@binference/core";
import type { MessageValues } from "@binference/i18n";
import type { Platform } from "@binference/platform";
import type { ConfigIssue } from "../config/config-issue.js";
import type { SecretReader } from "../config/secrets/secret-reader.js";
import type { InitFlags } from "../program/cli-flags.schema.js";
import type { CliHost } from "../program/cli-host.js";
import type { Prompter } from "../term/prompter.js";

/** What every step of `binference init` runs with. */
export interface InitContext {
  readonly host: CliHost;
  readonly platform: Platform;
  readonly flags: InitFlags;
  /** The person at the terminal, or the flags when nobody is there to answer. */
  readonly prompter: Prompter;
  /** Whether a person answers the questions; without one, every answer comes from a flag. */
  readonly isInteractive: boolean;
  /** A message of the `init` area in the owner's language. */
  readonly words: (key: string, values?: MessageValues) => string;
  /** Reads the secrets that flags name by their sources. */
  readonly secrets: SecretReader;
  readonly signal: AbortSignal;
}

/** Why init stopped: a dotted code for scripts, and the `init` message that tells the owner why. */
export interface InitRefusal {
  /** Such as `init.already_set_up`. */
  readonly code: string;
  /** The message key in the `init` area. */
  readonly key: string;
  readonly values?: MessageValues;
  /** Config issues explained under the message, when the config init would write does not load. */
  readonly issues?: readonly ConfigIssue[];
}

/** Why a step stopped init. */
export interface Refused {
  readonly ok: false;
  readonly refusal: InitRefusal;
}

/** What a step gives: its value, or why init stops. */
export type InitStep<T> = Ok<T> | Refused;

/** A step's refusal, from its code, its message and the message's values. */
export function refused(code: string, key: string, values?: MessageValues): Refused {
  return { ok: false, refusal: values === undefined ? { code, key } : { code, key, values } };
}
