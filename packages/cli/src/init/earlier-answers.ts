import type { Locale } from "@binference/protocol";
import { loadConfig } from "../config/load-config.js";
import { systemDefaults } from "../program/system-defaults.js";
import type { InitContext } from "./init-context.js";

/** What the config of an earlier set-up answered, which a start over asks with as its answers. */
export interface EarlierAnswers {
  readonly locale: Locale;
  readonly telemetry: boolean;
}

/**
 * The answers of the set-up a start over replaces, read from its `config.json5`: the language and
 * the telemetry choice. Nothing on a first set-up, nor when the file does not load.
 */
export async function earlierAnswersOf(context: InitContext): Promise<EarlierAnswers | undefined> {
  if (!context.flags.isStartOver) {
    return undefined;
  }
  const loaded = await loadConfig({
    file: context.platform.stateFolder.configFile,
    env: {},
    sets: [],
    system: systemDefaults(context.host.env, context.platform),
    signal: context.signal,
  });
  if (!loaded.ok) {
    return undefined;
  }
  const { config } = loaded;
  return { locale: config.owner.locale, telemetry: config.telemetry.enabled };
}
