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
import { configFileText } from "./config-file-text.js";
import { type InitContext, type InitStep, type Refused, refused } from "./init-context.js";

/** What init writes into the config itself; `--set` flags add the rest. */
export interface InitSettings {
  readonly unlockMode: UnlockMode;
  readonly unlockCommand?: CommandSource;
  readonly appId: string;
  readonly appSecret: SecretSource;
  readonly ownerKeyPublic: string;
  readonly botToken: SecretSource;
  /** The limits a person set at init, as entries below the flags'. */
  readonly limits: readonly LayerEntry[];
}

/** The config file init writes: its text, and the config it loads to. */
export interface InitConfig {
  readonly text: string;
  readonly config: BinferenceConfig;
}

// Keys init sets from its own steps; a `--set` flag cannot replace them.
const ownedPaths = ["version", "engine.unlock", "custody", "telegram.botToken"];

function ownedBy(set: string): string | undefined {
  const path = set.split("=")[0] ?? "";
  return ownedPaths.find((owned) => path === owned || path.startsWith(`${owned}.`));
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
  };
}

function configRefused(issues: readonly ConfigIssue[]): Refused {
  const count = issues.length;
  const refusal = {
    code: "config.invalid",
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
    ...settings.limits,
    own,
  ]);
  return flags.issues.length === 0 ? ok(merged.value) : configRefused(flags.issues);
}

/**
 * Builds the config file init writes (config spec, section 2): the owner's language and zone,
 * the unlock mode, the Privy app with its secret's source and the owner key's public half, the
 * bot token's source, the limits a person set and every `--set` flag, each key with its comment.
 * The text must load as `binference start` loads it; a flag that does not fit, or one on a key
 * init sets itself, stops init before anything is made.
 */
export async function initConfig(
  context: InitContext,
  settings: InitSettings,
  system: SystemDefaults,
): Promise<InitStep<InitConfig>> {
  const owned = context.flags.sets.map(ownedBy).find((path) => path !== undefined);
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
