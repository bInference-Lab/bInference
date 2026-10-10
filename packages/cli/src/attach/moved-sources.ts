import { basename, dirname, join, resolve } from "node:path";
import { ok } from "@binference/core";
import { readTextFile, writePrivateFile } from "@binference/platform";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import type { SecretSource } from "../config/schema/secret-source.schema.js";
import { type InitContext, type InitStep, refused } from "../init/init-context.js";

/** A secret source that names a file in another state folder's `keys/`, and where it moves. */
interface MovedSource {
  readonly path: string;
  readonly from: string;
  readonly to: string;
}

function sourcesOf(
  config: BinferenceConfig,
): readonly (readonly [string, SecretSource | undefined])[] {
  const { privy } = config.custody;
  const { telegram } = config;
  return [
    ["custody.privy.appSecret", privy.appSecret],
    ["telegram.botToken", telegram.botToken],
    ["telegram.confirmBotToken", telegram.confirmBotToken],
    ["telegram.webhookSecret", telegram.webhookSecret],
  ];
}

/**
 * The secret sources of a config copied from another machine that name a file in that machine's
 * state folder's `keys/`: each moves to the file of the same name in this folder's `keys/`.
 */
export function movedSources(
  context: InitContext,
  config: BinferenceConfig,
): readonly MovedSource[] {
  const keys = resolve(context.platform.stateFolder.keys);
  return sourcesOf(config).flatMap(([path, source]) => {
    if (source === undefined || !("fromFile" in source)) {
      return [];
    }
    const folder = dirname(resolve(source.fromFile));
    const isOtherKeys = basename(folder) === "keys" && folder !== keys;
    return isOtherKeys
      ? [{ path, from: source.fromFile, to: join(keys, basename(source.fromFile)) }]
      : [];
  });
}

/**
 * Moves the secret sources a copied config.json5 names in the old machine's `keys/` to this
 * folder's `keys/` (decision 0142), in the file's text, every other byte kept. A file whose text
 * names a source otherwise than `binference init` wrote it is left alone and stops attach with the
 * key to fix.
 */
export async function moveSources(
  context: InitContext,
  moves: readonly MovedSource[],
): Promise<InitStep<undefined>> {
  const file = context.platform.stateFolder.configFile;
  const read = await readTextFile(file, context.signal);
  const text = read.ok ? read.value : "";
  const unmatched = moves.find((move) => !text.includes(JSON.stringify(move.from)));
  if (unmatched !== undefined) {
    const { path, from, to } = unmatched;
    return refused("init.attach_moved_source", "refused.attachMovedSource", { path, from, to });
  }
  const moved = moves.reduce(
    (edited, move) => edited.replaceAll(JSON.stringify(move.from), JSON.stringify(move.to)),
    text,
  );
  const { permissions } = context.platform;
  await writePrivateFile(file, moved, { permissions, signal: context.signal });
  context.prompter.say(context.words("attach.sourcesMoved", { count: moves.length }));
  return ok(undefined);
}
