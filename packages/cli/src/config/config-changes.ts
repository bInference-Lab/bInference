import type { JsonValue } from "@binference/core";
import { applyTimeOf } from "./apply-times.js";
import type { BinferenceConfig } from "./schema/config.schema.js";
import { asJson, isObject, secretKindOf } from "./shown-config.js";

/** One key a reload of `config.json5` changed, with its value before and after it. */
export interface ConfigChangeFound {
  /** The key's path, such as `logging.level`. */
  readonly path: string;
  /** Absent for a key that is new. A secret source shows as its kind only. */
  readonly before?: JsonValue;
  /** Absent for a key that is gone. A secret source shows as its kind only. */
  readonly after?: JsonValue;
  /** The running engine reads the key on each use, so the change applies at once. */
  readonly appliesNow: boolean;
}

/** One value of the config: its JSON to compare, and what the journal shows. */
interface Leaf {
  readonly raw: string;
  readonly shown: JsonValue;
}

function leavesOf(value: JsonValue, path: readonly string[]): readonly (readonly [string, Leaf])[] {
  const kind = secretKindOf(value);
  if (isObject(value) && kind === undefined) {
    return Object.entries(value).flatMap(([key, child]) => leavesOf(child, [...path, key]));
  }
  return [[path.join("."), { raw: JSON.stringify(value), shown: kind ?? value }]];
}

function flatten(config: BinferenceConfig): ReadonlyMap<string, Leaf> {
  return new Map(leavesOf(asJson(config), []));
}

/** The configs a reload compares, and the one the engine started with. */
export interface ConfigsCompared {
  /** The config the parts that follow a reload read now. */
  readonly running: BinferenceConfig;
  /** The config read again. */
  readonly read: BinferenceConfig;
  /** The config the engine started with, which the parts that copy a key at start hold. */
  readonly started: BinferenceConfig;
}

/**
 * Compares the config the engine runs on with one read again, key by key down to each value: an
 * array and a secret source count as one value. Answers each key that changed, in path order,
 * with whether it applies now by the table of apply times (decision 0230).
 */
export function configChanges(compared: ConfigsCompared): readonly ConfigChangeFound[] {
  const { running, read, started } = compared;
  const before = flatten(running);
  const after = flatten(read);
  const paths = [...new Set([...before.keys(), ...after.keys()])].toSorted();
  return paths.flatMap((path) => {
    const was = before.get(path);
    const now = after.get(path);
    if (was?.raw === now?.raw) {
      return [];
    }
    const shownAfter = now === undefined ? {} : { after: now.shown };
    const change: ConfigChangeFound = {
      path,
      ...(was === undefined ? {} : { before: was.shown }),
      ...shownAfter,
      appliesNow: applyTimeOf({ path, ...shownAfter }, started) === "now",
    };
    return [change];
  });
}
