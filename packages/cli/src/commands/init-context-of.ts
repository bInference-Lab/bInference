import { homedir } from "node:os";
import type { Formatter, MessageValues } from "@binference/i18n";
import { platformOf } from "../compose/engine-locations.js";
import { createSecretReader } from "../config/secrets/secret-reader.js";
import type { AnswerKey, AnswerOrigin } from "../init/answer-names.js";
import type { InitContext } from "../init/init-context.js";
import type { InitFlags } from "../program/cli-flags.schema.js";
import type { CliHost } from "../program/cli-host.js";
import type { CliOutput } from "../program/cli-output.js";
import { createOutputPrompter } from "../term/output-prompter.js";

/** What an init context is made of: the flags with their answers filled, and their language. */
export interface InitOptions {
  readonly flags: InitFlags;
  readonly formatter: Formatter;
  /** Where each answer came from; a flag, or nothing, when left out. */
  readonly origins?: ReadonlyMap<AnswerKey, AnswerOrigin>;
}

/**
 * What the steps of `binference init`, and the restore steps it shares, run with: a person at the
 * terminal unless `--yes`, `--json` or no terminal, the `init` messages in the owner's language,
 * and the secrets the config's sources name.
 */
export function initContextOf(host: CliHost, output: CliOutput, options: InitOptions): InitContext {
  const { flags, formatter, origins = new Map() } = options;
  const platform = platformOf(host);
  const isInteractive = host.prompter !== undefined && !flags.yes && !flags.json;
  return {
    host,
    platform,
    flags,
    prompter:
      isInteractive && host.prompter !== undefined ? host.prompter : createOutputPrompter(output),
    isInteractive,
    words: (key: string, values?: MessageValues) => formatter.message(`init.${key}`, values),
    message: (key: string, values?: MessageValues) => formatter.message(key, values),
    dateTime: (epochMs: number) => formatter.dateTime(epochMs),
    secrets: createSecretReader({
      env: host.env,
      keychain: platform.keychain,
      homeDir: host.homeDir ?? homedir(),
      clock: host.clock,
    }),
    origins,
    signal: new AbortController().signal,
  };
}
