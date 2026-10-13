import { err, ok } from "@binference/core";
import type { EngineHandler } from "@binference/engine";
import { authorOf } from "@binference/engine/audit";
import {
  type FilePermissions,
  type Platform,
  readTextFile,
  writePrivateFile,
} from "@binference/platform";
import { configChanges } from "../config/config-changes.js";
import { editsOfPatch } from "../config/config-patch.js";
import { isJsonObject, jsonValueSchema } from "../config/json-value.schema.js";
import { editJson5Text } from "../config/json5-edit.js";
import type { ReadTextFile } from "../config/load-config.js";
import { shownConfig } from "../config/shown-config.js";
import type { ConfigOutcome } from "../config/validate-config.js";
import type { ConfigCell } from "./config-cell.js";
import type { ConfigReloadLink } from "./config-reload-link.js";

/** Writes a file only its owner can read, in place of the one there. */
type WritePrivateFile = typeof writePrivateFile;

/** What `config/change` reads, checks and writes. */
export interface ConfigChangeOptions {
  /** `config.json5` in the state folder: the file the live reload watches. */
  readonly file: string;
  readonly permissions: FilePermissions;
  /** The config the engine runs on now. */
  readonly settings: Pick<ConfigCell, "current">;
  /** Reads the config in the layers it runs with, the file's text given: the check before a write. */
  readonly validate: (text: string, signal: AbortSignal) => Promise<ConfigOutcome>;
  /** The reload path, which journals the change once, as the caller's (decision 0118). */
  readonly reload: ConfigReloadLink;
  /** The platform's reader unless a test passes another. */
  readonly readFile?: ReadTextFile;
  /** The platform's owner-only writer unless a test passes another. */
  readonly writeFile?: WritePrivateFile;
}

/**
 * The `config/change` of the CLI, the console and any `admin` client (protocol spec, section 7.9;
 * decision 0208). The patch is a JSON merge patch over `config.json5`: `null` removes a key, an
 * object merges into a group, anything else replaces the value whole. The file is edited in place,
 * every other byte, comment and key order kept, and the whole config is checked in the layers the
 * engine runs with before anything is written: a secret written as text is
 * `config.secret_inline`, any other problem, or a file the editor cannot change, `config.invalid`,
 * and nothing changes. The text goes to disk in one atomic write, then through the reload path,
 * which journals each changed key once with the caller as its author and the reason, and announces
 * it. It answers the config as it now stands, every secret source shown as its kind, and whether a
 * changed key applies only after a restart.
 */
export function createConfigChange(options: ConfigChangeOptions): EngineHandler<"config/change"> {
  const read = options.readFile ?? readTextFile;
  const write = options.writeFile ?? writePrivateFile;
  return async ({ args, caller, signal }) => {
    const patch = jsonValueSchema.safeParse(args.patch);
    if (!patch.success || !isJsonObject(patch.data)) {
      return err("protocol.bad_args");
    }
    const text = await read(options.file, signal);
    const edited = text.ok ? editJson5Text(text.value, editsOfPatch(patch.data)) : undefined;
    if (edited === undefined) {
      return err("config.invalid");
    }
    const checked = await options.validate(edited, signal);
    if (!checked.ok) {
      const isInline = checked.issues.some((issue) => issue.problem.kind === "secret_inline");
      return err(isInline ? "config.secret_inline" : "config.invalid");
    }
    const running = options.settings.current();
    await write(options.file, edited, { permissions: options.permissions, signal });
    const reason = args.reason === undefined ? {} : { reason: args.reason };
    await options.reload.applyNow({ author: authorOf(caller), ...reason }, signal);
    const changes = configChanges(running, checked.config);
    const restartNeeded = changes.some((change) => !change.appliesNow);
    return ok({ config: shownConfig(checked.config), restartNeeded });
  };
}

/** The `config/change` of the self-hosted engine, over the state folder's `config.json5`. */
export function composeConfigChange(
  platform: Pick<Platform, "stateFolder" | "permissions">,
  parts: Pick<ConfigChangeOptions, "settings" | "validate" | "reload">,
): { readonly "config/change": EngineHandler<"config/change"> } {
  const { stateFolder, permissions } = platform;
  return {
    "config/change": createConfigChange({ file: stateFolder.configFile, permissions, ...parts }),
  };
}
