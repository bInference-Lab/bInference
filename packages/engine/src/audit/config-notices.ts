import type { EnginePush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";

/** The first problem of a config file the engine refused to reload, as the notice names it. */
export interface ConfigProblemNamed {
  /** The problem's kind, such as `unreadable` or `bad_value`: the message's `problem` select. */
  readonly problem: string;
  /** The key's path, empty for the whole file. */
  readonly key: string;
  /** The line of a file that cannot be read, empty otherwise. */
  readonly line: string;
}

/**
 * The notice that the engine kept the settings it runs on because `config.json5` has a problem
 * (decision 0118), naming the first one by its line or its key.
 */
export function configInvalidNotice(named: ConfigProblemNamed): EnginePush {
  return noticePush({ key: "notice.configInvalid", values: { ...named } });
}

/**
 * The notice that a reload of `config.json5` changed settings (decision 0118): every changed key,
 * and those that apply only after a restart, `none` when every change applies now.
 */
export function configChangedNotice(changed: {
  readonly keys: readonly string[];
  readonly afterRestart: readonly string[];
}): EnginePush {
  const afterRestart = changed.afterRestart.length === 0 ? "none" : changed.afterRestart.join(", ");
  return noticePush({
    key: "notice.configChanged",
    values: { changed: changed.keys.join(", "), afterRestart },
  });
}
