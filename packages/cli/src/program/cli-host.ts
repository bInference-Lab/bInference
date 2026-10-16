import type { AssetRef } from "@binference/chain";
import type { Clock, Http, HttpDownload, Random } from "@binference/core";
import type { Engine } from "@binference/engine";
import type { ServiceManager, SignalEvents } from "@binference/platform";
import type { StartRuntime } from "../agent-runtime/start-runtime.js";
import type { McpStdio } from "../commands/mcp-command.js";
import type { StartSigner } from "../compose/start-signer.js";
import type { Prompter } from "../term/prompter.js";

/** How this binference was started, so the background service starts it the same way. */
interface BinferenceEntry {
  /** Node's absolute path, `process.execPath`. */
  readonly node: string;
  /** Node's own options, such as a TypeScript loader when it runs from source. */
  readonly nodeOptions: readonly string[];
  /** The absolute path of the entry script, `main.mjs` once built. */
  readonly script: string;
}

/**
 * Prices a test hands the engine's price triggers in place of the chains' price watchers, with
 * live auto order fills on, so a test drives live fills on a bare test chain.
 */
export interface TestOrders {
  /** Whether a price order on the token may be made, as the price watchers would answer. */
  readonly canPrice: (token: AssetRef) => boolean;
  /**
   * Starts handing prices to `see`, the engine's price triggers, as the price watchers start with
   * the engine's timers; answers how to stop.
   */
  readonly start: (see: Engine["seePrice"]) => () => void;
}

/**
 * What the `binference` command takes from its process. The entry file fills it from `process`;
 * tests fill it with a temporary state folder, a manual clock and an emitter for stop signals.
 */
export interface CliHost {
  /** The arguments after the program's name, such as `["status", "--json"]`. */
  readonly argv: readonly string[];
  /** The process's environment: `BINFERENCE_HOME` and every `BINFERENCE_*` config variable. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Writes to standard output. */
  readonly out: (text: string) => void;
  /** Writes to standard error. */
  readonly err: (text: string) => void;
  readonly clock: Clock;
  readonly random: Random;
  /** Reaches outside services, such as Privy's API and Telegram's Bot API. */
  readonly http: Http;
  /** Downloads files as bytes, such as the photos the owner sends the bot; absent, none is read. */
  readonly download?: HttpDownload;
  /** Asks the person at the terminal; absent when no person is there to answer. */
  readonly prompter?: Prompter;
  /** Where stop signals arrive: `process` in the entry file. */
  readonly signals: SignalEvents;
  /** The binference release, such as `2026.10.0`. */
  readonly version: string;
  /** The account's home folder; the OS's own answer when left out. */
  readonly homeDir?: string;
  /** Node options for the store's worker threads, such as a TypeScript loader in tests. */
  readonly workerExecArgv?: readonly string[];
  /** Starts the signer once the agent key opens; the built signer's process when left out. */
  readonly startSigner?: StartSigner;
  /** Starts the agent runtime's process; the built runtime when left out. */
  readonly startRuntime?: StartRuntime;
  /** How this binference was started, which the background service runs again. */
  readonly entry: BinferenceEntry;
  /**
   * Installs, stops and reads the background service; this OS's own when left out. Tests pass a
   * fake, so no test touches the machine's login items.
   */
  readonly serviceManager?: ServiceManager;
  /**
   * The folder of the console's build, which the engine serves; when left out, or before the
   * console is built, the engine serves no console.
   */
  readonly consoleFolder?: string;
  /** The streams `binference mcp` serves over: the process's stdin and stdout. */
  readonly mcpStdio?: McpStdio;
  /**
   * Only the crash suite's engine sets it, to drive live fills through a forced stop (decision
   * 0210). Left out, as the entry file leaves it, the price watchers price tokens and live auto
   * orders never fill: no config key or variable turns them on.
   */
  readonly testOrders?: TestOrders;
}
