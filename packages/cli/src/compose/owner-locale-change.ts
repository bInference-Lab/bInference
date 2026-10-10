import { err, ok } from "@binference/core";
import type { EngineHandler } from "@binference/engine";
import { type FilePermissions, readTextFile, writePrivateFile } from "@binference/platform";
import { localeSchema } from "@binference/protocol";
import { z } from "zod";
import type { ReadTextFile } from "../config/load-config.js";
import { withOwnerLocale } from "../config/owner-locale-text.js";
import { shownConfig } from "../config/shown-config.js";
import type { ConfigCell } from "./config-cell.js";

/** Writes a file only its owner can read, in place of the one there. */
type WritePrivateFile = typeof writePrivateFile;

/** What the owner's language change reads and writes. */
export interface OwnerLocaleChangeOptions {
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

const patchSchema = z.strictObject({ owner: z.strictObject({ locale: localeSchema }) });

/**
 * The `config/change` the owner's Telegram chat runs (decision 0134): it sets `owner.locale` in
 * `config.json5` and keeps every other byte of the file, its comments too. The live reload then
 * journals the change, announces it with `notice.configChanged` and applies it (decision 0118). A
 * patch of anything else is `protocol.bad_args`; a file this edit cannot read, or one the edit
 * would change in any other way, is `config.invalid`, and nothing is written. It answers the
 * config as it will be, every secret source shown as its kind.
 */
export function createOwnerLocaleChange(
  options: OwnerLocaleChangeOptions,
): EngineHandler<"config/change"> {
  const read = options.readFile ?? readTextFile;
  const write = options.writeFile ?? writePrivateFile;
  return async ({ args, signal }) => {
    const patch = patchSchema.safeParse(args.patch);
    if (!patch.success) {
      return err("protocol.bad_args");
    }
    const { locale } = patch.data.owner;
    const text = await read(options.file, signal);
    const edited = text.ok ? withOwnerLocale(text.value, locale) : undefined;
    if (edited === undefined) {
      return err("config.invalid");
    }
    await write(options.file, edited, { permissions: options.permissions, signal });
    const current = options.settings.current();
    const config = shownConfig({ ...current, owner: { ...current.owner, locale } });
    return ok({ config, restartNeeded: false });
  };
}
