import type { Result } from "@binference/core";
import { readTextFile } from "@binference/platform";
import type { Locale } from "@binference/protocol";
import { type ConfigIssue, configIssue, type ConfigOrigin } from "./config-issue.js";
import { configTree } from "./config-json-schema.js";
import { readConfigText } from "./config-text.js";
import { readEnvLayer } from "./layers/env-layer.js";
import { readFlagLayer } from "./layers/flag-layer.js";
import type { LayerEntry } from "./layers/layer-entry.js";
import { mergeLayers } from "./layers/merge-layers.js";
import { currentConfigVersion } from "./migrations/config-migrations.js";
import { fileVersion } from "./migrations/migrate-config.js";
import { type ConfigOutcome, validateConfig } from "./validate-config.js";

/** Defaults that depend on the machine, which the composition root reads from the OS. */
export interface SystemDefaults {
  readonly locale: Locale;
  readonly timezone: string;
  /** `keychain` when a desktop session exists, else `file`. */
  readonly unlockMode: "keychain" | "file";
}

/** Reads a text file; `not_found` when nothing is there. */
export type ReadTextFile = (
  path: string,
  signal: AbortSignal,
) => Promise<Result<string, "not_found">>;

/** What {@link loadConfig} reads, layer by layer. */
export interface LoadConfigOptions {
  /** `config.json5` in the state folder, or the path `--config` names. */
  readonly file: string;
  /** The engine process's environment: every `BINFERENCE_*` variable is a layer. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The value of each `--set key=value` flag, in the order given. */
  readonly sets: readonly string[];
  readonly system: SystemDefaults;
  readonly signal: AbortSignal;
  /** The platform's reader unless a test passes another. */
  readonly readFile?: ReadTextFile;
}

function invalid(issues: readonly ConfigIssue[]): ConfigOutcome {
  return { ok: false, issues };
}

function systemEntry(system: SystemDefaults): LayerEntry {
  return {
    path: [],
    value: {
      owner: { locale: system.locale, timezone: system.timezone },
      engine: { unlock: { mode: system.unlockMode } },
    },
    origin: { layer: "default", name: "" },
  };
}

async function readFileLayer(options: LoadConfigOptions): Promise<LayerEntry | ConfigIssue> {
  const origin: ConfigOrigin = { layer: "file", name: options.file };
  const read = await (options.readFile ?? readTextFile)(options.file, options.signal);
  if (!read.ok) {
    return configIssue([], { kind: "missing_file" }, origin);
  }
  const text = readConfigText(read.value);
  if (!text.ok) {
    return configIssue([], text.problem, origin);
  }
  const version = fileVersion(text.value);
  if (version !== undefined && version > currentConfigVersion) {
    const problem = { kind: "newer_version", version, supported: currentConfigVersion } as const;
    return configIssue(["version"], problem, origin);
  }
  if (version !== undefined && version < currentConfigVersion) {
    const problem = { kind: "older_version", version, current: currentConfigVersion } as const;
    return configIssue(["version"], problem, origin);
  }
  return { path: [], value: text.value, origin };
}

/**
 * Reads the config in its layers, lowest first: built-in defaults, the file, `BINFERENCE_*`
 * variables, then `--set` flags; each replaces the one below it key by key. Returns the
 * validated config, or every issue with its path, problem and fix. A file of another version
 * stops here: an older one needs `binference check --fix`, a newer one a newer binference.
 * Secrets stay sources; read each with a secret reader when it is needed.
 */
export async function loadConfig(options: LoadConfigOptions): Promise<ConfigOutcome> {
  const file = await readFileLayer(options);
  if ("problem" in file) {
    return invalid([file]);
  }
  const env = readEnvLayer(configTree, options.env);
  const flags = readFlagLayer(configTree, options.sets);
  const merged = mergeLayers(configTree, [
    systemEntry(options.system),
    file,
    ...env.entries,
    ...flags.entries,
  ]);
  const validated = validateConfig(merged);
  const issues = [...env.issues, ...flags.issues];
  if (issues.length === 0) {
    return validated;
  }
  return invalid(validated.ok ? issues : [...issues, ...validated.issues]);
}
