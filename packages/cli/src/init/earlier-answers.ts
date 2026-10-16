import type { Locale } from "@binference/protocol";
import { loadConfig } from "../config/load-config.js";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import type { SecretSource } from "../config/schema/secret-source.schema.js";
import { systemDefaults } from "../program/system-defaults.js";
import type { InitContext } from "./init-context.js";
import { type ModelPreset, modelPresetOf } from "./model-presets.js";

/** The model an earlier init linked: its provider as init offers it, the model and the key. */
export interface EarlierModel {
  readonly preset: ModelPreset;
  readonly baseUrl?: string;
  readonly model: string;
  /** Where the key is kept, which a start over may keep using without showing it. */
  readonly apiKey?: SecretSource;
}

/** What the config of an earlier set-up answered, which a start over asks with as its answers. */
export interface EarlierAnswers {
  readonly locale: Locale;
  readonly telemetry: boolean;
  readonly model?: EarlierModel;
}

function modelOf(config: BinferenceConfig): EarlierModel | undefined {
  const main = config.models.main ?? "";
  const slash = main.indexOf("/");
  const name = main.slice(0, slash);
  const provider = config.models.providers[name];
  const preset = provider === undefined ? undefined : modelPresetOf({ name, kind: provider.kind });
  if (slash <= 0 || provider === undefined || preset === undefined) {
    return undefined;
  }
  return {
    preset,
    ...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
    model: main.slice(slash + 1),
    ...(provider.apiKey === undefined ? {} : { apiKey: provider.apiKey }),
  };
}

/**
 * The answers of the set-up a start over replaces, read from its `config.json5`: the language,
 * the telemetry choice and the model with where its key is kept. Nothing on a first set-up, nor
 * when the file does not load.
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
  const model = modelOf(config);
  return {
    locale: config.owner.locale,
    telemetry: config.telemetry.enabled,
    ...(model === undefined ? {} : { model }),
  };
}
