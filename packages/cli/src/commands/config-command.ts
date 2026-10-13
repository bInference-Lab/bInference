import { jsonValueSchema as coreJsonValueSchema } from "@binference/core";
import JSON5 from "json5";
import { platformOf } from "../compose/engine-locations.js";
import { configTree } from "../config/config-json-schema.js";
import { nodeAt } from "../config/config-tree.js";
import { isJsonObject, type JsonValue, jsonValueSchema } from "../config/json-value.schema.js";
import { json5Inline } from "../config/json5-inline.js";
import { loadConfig } from "../config/load-config.js";
import { valueAt } from "../config/migrations/config-edit.js";
import { shownConfig } from "../config/shown-config.js";
import type { CommonOptions, ConfigSetFlags } from "../program/cli-flags.schema.js";
import type { ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { systemDefaults } from "../program/system-defaults.js";
import { refuseConfig } from "./config-refusal.js";
import { withEngine } from "./connect-engine.js";

// A key's parts: names joined with dots, none empty.
const keyPattern = /^[^.\s]+(?:\.[^.\s]+)*$/;

// Each value under a path as `key = value`, an object's keys one by one and any other value on its line.
function leaves(value: JsonValue, path: string): readonly (readonly [string, string])[] {
  if (isJsonObject(value) && Object.keys(value).length > 0) {
    return Object.entries(value).flatMap(([key, item]) =>
      leaves(item, path === "" ? key : `${path}.${key}`),
    );
  }
  return [[path, json5Inline(value)]];
}

/**
 * `binference config get [key]`: the config as it loads in its layers (defaults, config.json5, the
 * `BINFERENCE_*` variables), every secret source shown as its kind, or the one key named. It reads
 * the files on this machine and needs no running engine. A config that does not load is
 * `config.invalid` with each issue; a key the config does not hold is `config.unknown_key`. With
 * `--json` it prints the value.
 */
export async function runConfigGet(
  run: CommandRun,
  request: { readonly options: CommonOptions; readonly key?: string },
): Promise<ExitCode> {
  const { host, output } = run;
  const platform = platformOf(host);
  const file = platform.stateFolder.configFile;
  const system = systemDefaults(host.env, platform);
  const signal = AbortSignal.timeout(15_000);
  const loaded = await loadConfig({ file, env: host.env, sets: [], system, signal });
  if (!loaded.ok) {
    refuseConfig(output, loaded.issues);
    return 1;
  }
  const shown = jsonValueSchema.parse(shownConfig(loaded.config));
  const { key } = request;
  const value =
    key === undefined ? shown : valueAt(isJsonObject(shown) ? shown : {}, key.split("."));
  if (value === undefined) {
    output.fail({ code: "config.unknown_key", key: "configGet.noKey", values: { key: key ?? "" } });
    return 1;
  }
  output.json(coreJsonValueSchema.parse(value));
  for (const [path, text] of leaves(value, key ?? "")) {
    output.say("configGet.value", { key: path, value: text });
  }
  return 0;
}

// The value typed: JSON5 when it reads as JSON5, else the text itself.
function typedValue(text: string): JsonValue {
  try {
    const parsed = jsonValueSchema.safeParse(JSON5.parse(text));
    return parsed.success ? parsed.data : text;
  } catch {
    return text;
  }
}

/** What `binference config set` was asked. */
export interface ConfigSetRequest {
  readonly options: ConfigSetFlags;
  readonly key: string;
  readonly value?: string;
}

/** The value a request sets, or why it names none it may send. */
type AskedValue =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly problem: "not_one" | "secret_as_text" };

// The value the request sets, or why it names none it may send.
function valueOf(request: ConfigSetRequest): AskedValue {
  const { fromEnv, fromKeychain } = request.options;
  const given = [request.value, fromEnv, fromKeychain].filter((each) => each !== undefined);
  if (given.length !== 1) {
    return { ok: false, problem: "not_one" };
  }
  if (fromEnv !== undefined) {
    return { ok: true, value: { fromEnv } };
  }
  if (fromKeychain !== undefined) {
    return { ok: true, value: { fromKeychain } };
  }
  const value = typedValue(request.value ?? "");
  const node = nodeAt(configTree, request.key.split("."));
  const isSecret = node?.kind === "value" && node.rule.kind === "secret";
  return isSecret && value !== null && !isJsonObject(value)
    ? { ok: false, problem: "secret_as_text" }
    : { ok: true, value };
}

/**
 * `binference config set <key> [value]`: changes one key of config.json5 through `config/change`
 * (decision 0208), which edits the file in place, keeps its comments, checks the whole config
 * before it writes, and journals the change as this CLI's with `--reason`. The value reads as
 * JSON5, else as text; `null` removes the key. A secret takes its source, `--from-env` or
 * `--from-keychain`: a secret typed as text is refused here, so it never leaves this process. It
 * says when the change applies only after a restart. With `--json` it prints the operation's
 * answer.
 */
export async function runConfigSet(run: CommandRun, request: ConfigSetRequest): Promise<ExitCode> {
  const { output } = run;
  const { key } = request;
  if (!keyPattern.test(key)) {
    output.fail({ code: "protocol.bad_args", key: "configSet.badKey", values: { key } });
    return 1;
  }
  const asked = valueOf(request);
  if (!asked.ok) {
    const isSecret = asked.problem === "secret_as_text";
    const code = isSecret ? "config.secret_inline" : "protocol.bad_args";
    output.fail({
      code,
      key: isSecret ? "configSet.secretSource" : "configSet.oneValue",
      values: { key },
    });
    return 1;
  }
  const patch = key
    .split(".")
    .toReversed()
    .reduce<JsonValue>((inner, part) => ({ [part]: inner }), asked.value);
  const { reason } = request.options;
  return withEngine(run.host, output, async (client, signal) => {
    const args = {
      patch: isJsonObject(patch) ? patch : {},
      ...(reason === undefined ? {} : { reason }),
    };
    const answer = await client.call("config/change", args, { signal });
    output.json(coreJsonValueSchema.parse(answer));
    output.say("configSet.done", { key });
    if (answer.restartNeeded) {
      output.say("configSet.restart");
    }
    return 0;
  });
}
