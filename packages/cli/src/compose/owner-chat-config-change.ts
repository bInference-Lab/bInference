import { err, ok } from "@binference/core";
import type { EngineHandler } from "@binference/engine";
import { type OwnerChatPatch, ownerChatPatchSchema } from "@binference/engine/surfaces";
import {
  type FilePermissions,
  type Platform,
  readTextFile,
  writePrivateFile,
} from "@binference/platform";
import { editJson5Text } from "../config/json5-edit.js";
import type { ReadTextFile } from "../config/load-config.js";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import { shownConfig } from "../config/shown-config.js";
import type { ConfigCell } from "./config-cell.js";

/** Writes a file only its owner can read, in place of the one there. */
type WritePrivateFile = typeof writePrivateFile;

/** What the owner's chat's config change reads and writes. */
export interface OwnerChatConfigChangeOptions {
  /** `config.json5` in the state folder: the file the live reload watches. */
  readonly file: string;
  readonly permissions: FilePermissions;
  /** The config the engine runs on now. */
  readonly settings: Pick<ConfigCell, "current">;
  /** The platform's reader unless a test passes another. */
  readonly readFile?: ReadTextFile;
  /** The platform's owner-only writer unless a test passes another. */
  readonly writeFile?: WritePrivateFile;
}

/** The one key a patch sets, its path and its value, and the config as it will be. */
interface PatchEdit {
  readonly path: readonly string[];
  readonly value: string;
  readonly config: BinferenceConfig;
}

function editOf(patch: OwnerChatPatch, current: BinferenceConfig): PatchEdit {
  if ("owner" in patch) {
    const { locale } = patch.owner;
    const config = { ...current, owner: { ...current.owner, locale } };
    return { path: ["owner", "locale"], value: locale, config };
  }
  const { telegram } = current;
  const set = patch.telegram.replies;
  const config = {
    ...current,
    telegram: { ...telegram, replies: { ...telegram.replies, ...set } },
  };
  return "stream" in set
    ? { path: ["telegram", "replies", "stream"], value: set.stream, config }
    : { path: ["telegram", "replies", "reasoning"], value: set.reasoning, config };
}

/**
 * The `config/change` the owner's Telegram chat runs (decisions 0134 and 0377): it sets one of
 * `owner.locale`, `telegram.replies.stream` and `telegram.replies.reasoning` in `config.json5`
 * and keeps every other byte of the file, its comments too. The live reload then journals the
 * change, announces it with `notice.configChanged` and applies it (decision 0118). A patch of
 * anything else is `protocol.bad_args`; a file this edit cannot read, or one the edit would
 * change in any other way, is `config.invalid`, and nothing is written. It answers the config as
 * it will be, every secret source shown as its kind.
 */
export function createOwnerChatConfigChange(
  options: OwnerChatConfigChangeOptions,
): EngineHandler<"config/change"> {
  const read = options.readFile ?? readTextFile;
  const write = options.writeFile ?? writePrivateFile;
  return async ({ args, signal }) => {
    const patch = ownerChatPatchSchema.safeParse(args.patch);
    if (!patch.success) {
      return err("protocol.bad_args");
    }
    const { path, value, config } = editOf(patch.data, options.settings.current());
    const text = await read(options.file, signal);
    const edited = text.ok ? editJson5Text(text.value, [{ kind: "set", path, value }]) : undefined;
    if (edited === undefined) {
      return err("config.invalid");
    }
    await write(options.file, edited, { permissions: options.permissions, signal });
    return ok({ config: shownConfig(config), restartNeeded: false });
  };
}

/**
 * The handlers only the owner's bot runs: the `config/change` that sets the owner's language or
 * how replies show in the chat, in the state folder's `config.json5` (decisions 0134 and 0377).
 */
export function ownerChatHandlers(
  platform: Platform,
  settings: ConfigCell,
): { readonly "config/change": EngineHandler<"config/change"> } {
  const { stateFolder, permissions } = platform;
  return {
    "config/change": createOwnerChatConfigChange({
      file: stateFolder.configFile,
      permissions,
      settings,
    }),
  };
}
