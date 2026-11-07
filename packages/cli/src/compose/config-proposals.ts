import { err, ok, type Result } from "@binference/core";
import type {
  ConfigChangePreview,
  ConfigChanges,
  ConfigKeyChange,
  ConfigPatch,
  ConfigPreviewRefusal,
} from "@binference/engine/audit";
import { configChangeLimits } from "@binference/engine/audit";
import { readTextFile, writePrivateFile } from "@binference/platform";
import { configChanges } from "../config/config-changes.js";
import { configTree } from "../config/config-json-schema.js";
import { configKeyRules } from "../config/config-key-rules.js";
import { editsOfPatch } from "../config/config-patch.js";
import { isJsonObject, type JsonValue, jsonValueSchema } from "../config/json-value.schema.js";
import { editJson5Text } from "../config/json5-edit.js";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import { shownConfig } from "../config/shown-config.js";
import type { ConfigChangeOptions } from "./config-change.js";
import type { Opened, Opening } from "./open-engine-parts.js";
import { ownerChatHandlers } from "./owner-chat-config-change.js";

/** The file's text as it stands and with the patch, each read in the layers the engine runs with. */
interface PatchRead {
  readonly edited: string;
  readonly before: BinferenceConfig;
  readonly after: BinferenceConfig;
}

// A value as the card shows it: JSON text, `null` for a key with no value, cut to the card's room.
function valueText(value: JsonValue | undefined): string {
  const text = JSON.stringify(value ?? null);
  const room = configChangeLimits.valueChars;
  return text.length <= room ? text : `${text.slice(0, room - 1)}…`;
}

function refusalOf(issues: readonly { readonly problem: { readonly kind: string } }[]) {
  const isInline = issues.some((issue) => issue.problem.kind === "secret_inline");
  return isInline ? "config.secret_inline" : "config.invalid";
}

async function readPatch(
  options: ConfigChangeOptions,
  patch: ConfigPatch,
  signal: AbortSignal,
): Promise<Result<PatchRead, ConfigPreviewRefusal>> {
  const parsed = jsonValueSchema.safeParse(patch);
  const read = options.readFile ?? readTextFile;
  const text = await read(options.file, signal);
  if (!parsed.success || !isJsonObject(parsed.data) || !text.ok) {
    return err("config.invalid");
  }
  const edited = editJson5Text(text.value, editsOfPatch(parsed.data));
  if (edited === undefined) {
    return err("config.invalid");
  }
  const [was, now] = await Promise.all([
    options.validate(text.value, signal),
    options.validate(edited, signal),
  ]);
  if (!now.ok) {
    return err(refusalOf(now.issues));
  }
  return was.ok ? ok({ edited, before: was.config, after: now.config }) : err("config.invalid");
}

function previewOf(options: ConfigChangeOptions, read: PatchRead): ConfigChangePreview {
  const found = configChanges({
    running: read.before,
    read: read.after,
    started: options.settings.started,
  });
  return {
    changes: found.map(({ path, before, after }) => ({
      path,
      before: valueText(before),
      after: valueText(after),
    })),
    restartNeeded: found.some((change) => !change.appliesNow),
  };
}

const sameChange = (one: ConfigKeyChange, other: ConfigKeyChange): boolean =>
  one.path === other.path && one.before === other.before && one.after === other.after;

// Every key the patch would still change must be one the card showed, from the same value to the
// same value; a key already at its new value is done.
function isUnmoved(now: readonly ConfigKeyChange[], card: readonly ConfigKeyChange[]): boolean {
  return now.every((change) => card.some((shown) => sameChange(change, shown)));
}

function view(options: ConfigChangeOptions, path: string | undefined) {
  const keys = path === undefined ? [] : path.split(".");
  const rules = configKeyRules(configTree, keys);
  if (rules === undefined) {
    return err("protocol.bad_args" as const);
  }
  const shown = keys.reduce<JsonValue | undefined>(
    (node, key) => (isJsonObject(node) ? node[key] : undefined),
    shownConfig(options.settings.current()),
  );
  return ok({ ...(shown === undefined ? {} : { value: shown }), rules });
}

/**
 * The config file as the self-hosted engine's config changes read and write it (decision 0393):
 * a preview edits a copy of `config.json5`'s text with the JSON merge patch, as `config/change`
 * does, checks the file before and after in the layers the engine runs with, and answers each key
 * that changes, its values shown as `config/change` shows them; apply previews again, refuses a
 * key the card did not show as it stands (`config_moved`), writes the file in one atomic write
 * and journals it through the reload path with the owner who confirmed it.
 */
export function createConfigProposals(options: ConfigChangeOptions): ConfigChanges {
  const write = options.writeFile ?? writePrivateFile;
  return {
    view: async (path) => Promise.resolve(view(options, path)),
    async preview(patch, { signal }) {
      const read = await readPatch(options, patch, signal);
      return read.ok ? ok(previewOf(options, read.value)) : read;
    },
    async apply({ patch, quote, reason }, { author, signal }) {
      const read = await readPatch(options, patch, signal);
      if (!read.ok) {
        return err("config_invalid");
      }
      const { changes } = previewOf(options, read.value);
      if (!isUnmoved(changes, quote.changes)) {
        return err("config_moved");
      }
      if (changes.length > 0) {
        const { permissions } = options;
        await write(options.file, read.value.edited, { permissions, signal });
        const why = reason === undefined ? {} : { reason };
        await options.reload.applyNow({ author, ...why }, signal);
      }
      return ok(undefined);
    },
  };
}

/**
 * What the chats change in the self-hosted engine's `config.json5`: the owner's bot's own
 * `config/change` of the language and the replies (decisions 0134 and 0377), and the config file a
 * confirmed config change from any chat writes (decision 0393).
 */
export function chatConfigPartsOf(
  opening: Pick<Opening, "platform">,
  opened: Pick<Opened, "settings" | "readConfigFrom" | "configReload">,
): {
  readonly ownerChat: ReturnType<typeof ownerChatHandlers>;
  readonly configChanges: ConfigChanges;
} {
  const { platform } = opening;
  const { stateFolder, permissions } = platform;
  return {
    ownerChat: ownerChatHandlers(platform, opened.settings),
    configChanges: createConfigProposals({
      file: stateFolder.configFile,
      permissions,
      settings: opened.settings,
      validate: opened.readConfigFrom,
      reload: opened.configReload,
    }),
  };
}
