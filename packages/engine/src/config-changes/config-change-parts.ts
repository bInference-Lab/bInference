import type { Result } from "@binference/core";
import type { ResultOf } from "@binference/protocol";
import type { ConfigAuthor } from "../audit/journal-config-change.js";
import type { ConfigChangeQuote, ConfigKeyChange, ConfigPatch } from "./config-change-quote.js";

/** Why a config change cannot apply: a key moved since its card, or the config refuses it. */
export type ConfigChangeRefusal = "config_moved" | "config_invalid";

/**
 * Why a patch cannot be proposed: the config would fail its checks, it writes a secret's value
 * into the file, which a chat never carries, or it names a secret that is not there to read
 * (decisions 0393 and 0395).
 */
export type ConfigPreviewRefusal =
  | "config.invalid"
  | "config.secret_inline"
  | "config.secret_unreadable"
  | "config.changed"
  | "config.list_shrinks";

/** A patch to preview, with the hash it was made from and the lists it may shorten. */
export interface ConfigPatchAsked {
  readonly patch: ConfigPatch;
  /** The `hash` of the `config/view` the patch was made from; none from the owner's `/config`. */
  readonly baseHash?: string;
  /** Lists whose entries the patch may drop. */
  readonly replacePaths?: readonly string[];
}

/** What a merge patch would change, as a card shows it, or why the config refuses it. */
export interface ConfigChangePreview {
  readonly changes: readonly ConfigKeyChange[];
  readonly restartNeeded: boolean;
}

/**
 * The config file as the composition root owns it (decision 0393): it previews what a JSON merge
 * patch over `config.json5` would change, checked in every layer the engine runs with, and applies
 * a confirmed one, journaled and announced with the owner who confirmed it. A key that stands at
 * its card's value after counts as applied, so a change a stop cut short applies once; a key that
 * stands at neither its value before nor after is `config_moved`, and nothing is written. The
 * engine holds no config of its own.
 */
export interface ConfigChanges {
  /**
   * The config the engine runs with, or the value at one dotted path, each secret source shown as
   * its kind and never its value, with the rules of the keys under it; an unknown path is
   * `protocol.bad_args`.
   */
  view(
    path: string | undefined,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<ResultOf<"config/view">, "protocol.bad_args">>;
  /**
   * What the patch would change: refused when the file's hash is not `baseHash`
   * (`config.changed`), or when it drops entries from a list `replacePaths` does not name
   * (`config.list_shrinks`), as well as for the config's own checks.
   */
  preview(
    asked: ConfigPatchAsked,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<ConfigChangePreview, ConfigPreviewRefusal>>;
  apply(
    change: {
      readonly patch: ConfigPatch;
      readonly quote: ConfigChangeQuote;
      /** Why, in the proposer's words, which the journal keeps. */
      readonly reason?: string;
    },
    options: { readonly author: ConfigAuthor; readonly signal: AbortSignal },
  ): Promise<Result<undefined, ConfigChangeRefusal>>;
}
