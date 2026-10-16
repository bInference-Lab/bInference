import { ok } from "@binference/core";
import type { ConfigIssue } from "../config/config-issue.js";
import { configTree } from "../config/config-json-schema.js";
import type { JsonObject } from "../config/json-value.schema.js";
import { readFlagLayer } from "../config/layers/flag-layer.js";
import type { LayerEntry } from "../config/layers/layer-entry.js";
import { mergeLayers } from "../config/layers/merge-layers.js";
import { loadConfig, type SystemDefaults } from "../config/load-config.js";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import type { UnlockMode } from "../config/schema/engine.schema.js";
import type { CommandSource, SecretSource } from "../config/schema/secret-source.schema.js";
import type { ProviderKind } from "../config/schema/telegram-models.schema.js";
import { configFileText } from "./config-file-text.js";
import { type InitContext, type InitStep, type Refused, refused } from "./init-context.js";

/** The model init linked (decision 0221): its provider, the model, and its key's source. */
export interface ModelSettings {
  /** The provider's name in `models.providers`. */
  readonly name: string;
  readonly kind: ProviderKind;
  readonly baseUrl?: string;
  readonly apiKey?: SecretSource;
  readonly model: string;
  /** It read the image check's test image, so `models.imageInput` lists it (decision 0228). */
  readonly readsImages?: true;
}

/** What init writes into the config itself; `--set` flags add the rest. */
export interface InitSettings {
  readonly unlockMode: UnlockMode;
  readonly unlockCommand?: CommandSource;
  readonly appId: string;
  readonly appSecret: SecretSource;
  readonly ownerKeyPublic: string;
  readonly botToken: SecretSource;
  /** The model, when one was linked; it then sets `models.main` and `models.fast`. */
  readonly model?: ModelSettings;
  /** What a person answered at init besides these, such as the limits, as entries. */
  readonly asked: readonly LayerEntry[];
}

/** The config file init writes: its text, and the config it loads to. */
export interface InitConfig {
  readonly text: string;
  readonly config: BinferenceConfig;
}

// Keys init sets from its own steps; a `--set` flag cannot replace them.
const ownedPaths = ["version", "engine.unlock", "custody", "telegram.botToken"];
const modelPaths = ["models.providers", "models.main", "models.fast", "models.imageInput"];

function ownedBy(set: string, settings: InitSettings): string | undefined {
  const path = set.split("=")[0] ?? "";
  const owned = settings.model === undefined ? ownedPaths : [...ownedPaths, ...modelPaths];
  return owned.find((item) => path === item || path.startsWith(`${item}.`));
}

function modelsValue(model: ModelSettings): JsonObject {
  const provider = {
    kind: model.kind,
    ...(model.baseUrl === undefined ? {} : { baseUrl: model.baseUrl }),
    ...(model.apiKey === undefined ? {} : { apiKey: { ...model.apiKey } }),
  };
  const named = `${model.name}/${model.model}`;
  const images = model.readsImages === true ? { imageInput: [named] } : {};
  return { providers: { [model.name]: provider }, main: named, fast: named, ...images };
}

function settingsValue(settings: InitSettings): JsonObject {
  const { unlockCommand } = settings;
  const command =
    unlockCommand === undefined ? {} : { command: { fromCommand: [...unlockCommand.fromCommand] } };
  return {
    engine: { unlock: { mode: settings.unlockMode, ...command } },
    custody: {
      privy: {
        appId: settings.appId,
        appSecret: { ...settings.appSecret },
        ownerKeyPublic: settings.ownerKeyPublic,
      },
    },
    telegram: { botToken: { ...settings.botToken } },
    ...(settings.model === undefined ? {} : { models: modelsValue(settings.model) }),
  };
}

// A secret written as text is `config.secret_inline`, as config spec section 4 says; the issue
// names its key, never the text.
function configRefused(issues: readonly ConfigIssue[]): Refused {
  const count = issues.length;
  const isInline = issues.some((issue) => issue.problem.kind === "secret_inline");
  const refusal = {
    code: isInline ? "config.secret_inline" : "config.invalid",
    key: "refused.configInvalid",
    values: { count },
    issues,
  };
  return { ok: false, refusal };
}

function fileValue(
  context: InitContext,
  settings: InitSettings,
  system: SystemDefaults,
): InitStep<JsonObject> {
  const file = { layer: "file", name: context.platform.stateFolder.configFile } as const;
  const flags = readFlagLayer(configTree, context.flags.sets);
  // The version comes first in the file, then the owner, which a flag may change.
  const version: LayerEntry = { path: ["version"], value: currentConfigVersion, origin: file };
  const owner: LayerEntry = {
    path: ["owner"],
    value: { locale: system.locale, timezone: system.timezone },
    origin: file,
  };
  const own: LayerEntry = { path: [], value: settingsValue(settings), origin: file };
  const merged = mergeLayers(configTree, [
    version,
    owner,
    ...flags.entries,
    ...settings.asked,
    own,
  ]);
  return flags.issues.length === 0 ? ok(merged.value) : configRefused(flags.issues);
}

/**
 * Builds the config file init writes (config spec, section 2): the owner's language and zone,
 * the unlock mode, the Privy app with its secret's source and the owner key's public half, the
 * bot token's source, the model with its key's source, the limits and telemetry choice a person
 * set and every `--set` flag, each key with its comment.
 * The text must load as `binference start` loads it; a flag that does not fit, or one on a key
 * init sets itself, stops init before anything is made.
 */
export async function initConfig(
  context: InitContext,
  settings: InitSettings,
  system: SystemDefaults,
): Promise<InitStep<InitConfig>> {
  const owned = context.flags.sets
    .map((set) => ownedBy(set, settings))
    .find((path) => path !== undefined);
  if (owned !== undefined) {
    return refused("init.set_owned", "refused.setOwned", { path: owned });
  }
  const value = fileValue(context, settings, system);
  if (!value.ok) {
    return value;
  }
  const text = configFileText(value.value, configTree);
  const loaded = await loadConfig({
    file: context.platform.stateFolder.configFile,
    env: {},
    sets: [],
    system,
    signal: context.signal,
    readFile: async () => Promise.resolve(ok(text)),
  });
  return loaded.ok ? ok({ text, config: loaded.config }) : configRefused(loaded.issues);
}
