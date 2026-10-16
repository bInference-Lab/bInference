import { BinferenceError, type Clock, type Logger } from "@binference/core";
import {
  type ConfigChangeParts,
  configChangedNotice,
  configInvalidNotice,
  journalConfigChange,
} from "@binference/engine/audit";
import type { FileWatch, WatchFileOptions } from "@binference/platform";
import type { ConfigChangeFound } from "../config/config-changes.js";
import { configChanges } from "../config/config-changes.js";
import type { ConfigIssue } from "../config/config-issue.js";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import type { Closers } from "./closers.js";
import type { ConfigCell } from "./config-cell.js";
import type { ConfigReloadLink, ReloadAuthor } from "./config-reload-link.js";
import type { Opened } from "./open-engine-parts.js";

/** What reloads the settings when `config.json5` changes. */
export interface ConfigReloadOptions {
  /** `config.json5` in the state folder. */
  readonly file: string;
  /** Reads the config again in the layers it started with. */
  readonly readConfig: Opened["readConfig"];
  /** Where the parts that follow a reload read the config. */
  readonly settings: ConfigCell;
  /** The config journal, and where its entries and the notices are pushed. */
  readonly journal: ConfigChangeParts;
  /**
   * Hands the changed keys to the parts that read secrets again or send settings on, once the cell
   * holds the new config and before the notice names the changes as applied.
   */
  readonly follow: (changed: readonly string[], signal: AbortSignal) => Promise<void>;
  /** Watches the file: the platform's watcher, or a test's. */
  readonly watch: (path: string, options: WatchFileOptions) => FileWatch;
  readonly clock: Clock;
  readonly closers: Closers;
  readonly logger: Logger;
}

// One save can fire several changes; the reload waits for them to settle (decision 0118).
const settleMs = 500;
const byEngine: ReloadAuthor = { author: { by: "engine", surface: "config.json5" } };

function refuse(options: ConfigReloadOptions, issues: readonly ConfigIssue[]): void {
  const [issue] = issues;
  if (issue === undefined) {
    return;
  }
  const { problem } = issue;
  options.logger.warn("config.reload_refused", { errorCode: `config.${problem.kind}` });
  const line = problem.kind === "unreadable" ? String(problem.line) : "";
  options.journal.publish(configInvalidNotice({ problem: problem.kind, key: issue.path, line }));
}

// A part that fails to follow keeps what it held and logs it; the other parts and the notice go on.
async function follow(
  options: ConfigReloadOptions,
  keys: readonly string[],
  signal: AbortSignal,
): Promise<void> {
  try {
    await options.follow(keys, signal);
  } catch (error) {
    signal.throwIfAborted();
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    options.logger.warn("config.follow_failed", { errorCode });
  }
}

// Each changed key is journaled before the new config is put in place.
async function apply(
  options: ConfigReloadOptions,
  read: {
    readonly config: BinferenceConfig;
    readonly changes: readonly ConfigChangeFound[];
    readonly by: ReloadAuthor;
  },
  signal: AbortSignal,
): Promise<void> {
  const { changes, by } = read;
  await changes.reduce<Promise<void>>(async (earlier, { path, before, after }) => {
    await earlier;
    const change = {
      author: by.author,
      atMs: options.clock.now(),
      path,
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
      ...(by.reason === undefined ? {} : { reason: by.reason }),
    };
    await journalConfigChange(options.journal, change, { signal });
  }, Promise.resolve());
  options.settings.replace(read.config);
  const keys = changes.map((change) => change.path);
  await follow(options, keys, signal);
  const afterRestart = changes.filter((change) => !change.appliesNow).map((change) => change.path);
  options.journal.publish(configChangedNotice({ keys, afterRestart }));
  options.logger.info("config.reloaded");
}

async function reload(
  options: ConfigReloadOptions,
  by: ReloadAuthor,
  signal: AbortSignal,
): Promise<void> {
  const loaded = await options.readConfig(signal);
  if (!loaded.ok) {
    refuse(options, loaded.issues);
    return;
  }
  const { settings } = options;
  const compared = { running: settings.current(), read: loaded.config, started: settings.started };
  const changes = configChanges(compared);
  if (changes.length > 0) {
    await apply(options, { config: loaded.config, changes, by }, signal);
  }
}

/**
 * Reloads the settings once `config.json5` has stopped changing for 500 ms (decision 0118): a
 * file with problems keeps the running config, is logged and is named in `notice.configInvalid`;
 * otherwise each changed key is journaled by `engine` on the surface `config.json5`, the config
 * cell takes the new config, and `notice.configChanged` lists the changes and those that apply
 * only after a restart. Reloads run one at a time. A writer such as `config/change` reloads at
 * once through the answer's `applyNow`, journaled as its own, so the watch that follows finds no
 * change and nothing is journaled twice. Its closer stops the watch first.
 */
export function startConfigReload(options: ConfigReloadOptions): ConfigReloadLink {
  const stop = new AbortController();
  const state = { pending: new AbortController(), turn: Promise.resolve() };
  const runReload = async (by: ReloadAuthor): Promise<void> => {
    try {
      await reload(options, by, stop.signal);
    } catch (error) {
      const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
      options.logger.warn("config.reload_failed", { errorCode });
    }
  };
  const onChange = (): void => {
    state.pending.abort();
    const pending = new AbortController();
    state.pending = pending;
    const settle = AbortSignal.any([pending.signal, stop.signal]);
    void (async () => {
      try {
        await options.clock.sleep(settleMs, settle);
      } catch {
        return;
      }
      state.turn = state.turn.then(async () => runReload(byEngine));
    })();
  };
  const onError = (error: BinferenceError): void => {
    options.logger.warn("config.watch_stopped", { errorCode: error.code });
  };
  const watching = options.watch(options.file, { onChange, onError });
  options.closers.add("config reload", async () => {
    watching.close();
    stop.abort();
    await state.turn;
  });
  return {
    applyNow: async (by, signal) => {
      signal.throwIfAborted();
      state.turn = state.turn.then(async () => runReload(by));
      await state.turn;
    },
  };
}
