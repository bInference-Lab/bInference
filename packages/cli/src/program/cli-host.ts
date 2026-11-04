import type { AssetRef } from "@binference/chain";
import type { Clock, Http, HttpDownload, Random, SecretStore } from "@binference/core";
import type { Engine } from "@binference/engine";
import type {
  ProgramExit,
  RunWithinOptions,
  ServiceManager,
  SignalEvents,
  SystemFacts,
} from "@binference/platform";
import type { ChatTerminal } from "@binference/tui";
import type { Address } from "viem";
import type { StartRuntime } from "../agent-runtime/start-runtime.js";
import type { McpStdio } from "../commands/mcp-command.js";
import type { PluginPrograms } from "../compose/plugin-sandbox.js";
import type { StartSigner } from "../compose/start-signer.js";
import type { OutboundSwitch } from "../runtime/system-http.js";
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
  /**
   * Where a command puts the route of `network.proxy` and `network.noProxy` in force for `http`
   * and `download`, and opens its WebSockets by it: the entry file's own adapter, which refuses
   * every request until a route is put in force (decision 0347). Tests that answer `http`
   * themselves pass one that records the route.
   */
  readonly outbound: OutboundSwitch;
  /** Asks the person at the terminal; absent when no person is there to answer. */
  readonly prompter?: Prompter;
  /** Where stop signals arrive: `process` in the entry file. */
  readonly signals: SignalEvents;
  /** The binference release, such as `2026.10.0`. */
  readonly version: string;
  /** The machine binference runs on, from `process` in the entry file. */
  readonly system: SystemFacts;
  /** The account's home folder; the OS's own answer when left out. */
  readonly homeDir?: string;
  /** Node options for the store's worker threads, such as a TypeScript loader in tests. */
  readonly workerExecArgv?: readonly string[];
  /** Starts the signer once the agent key opens; the built signer's process when left out. */
  readonly startSigner?: StartSigner;
  /**
   * The plugin program and the probe plugin the sandbox check runs; the built ones when left
   * out. Tests pass a build of their own.
   */
  readonly pluginPrograms?: PluginPrograms;
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
   * The OS keychain, entries under the service `binference`; this OS's own when left out. Tests
   * pass a store of their own.
   */
  readonly keychain?: SecretStore;
  /**
   * Runs an OS program, such as npm when `binference uninstall` removes the program;
   * `runCommandWithin` of the platform when left out. Tests pass a recorder, so no test runs npm.
   */
  readonly runProgram?: (
    file: string,
    args: readonly string[],
    options: RunWithinOptions,
  ) => Promise<ProgramExit>;
  /**
   * Folders to look in for an outside program, such as Tailscale's CLI, after the `PATH` of
   * `env`: where installers put programs a background service's `PATH` lacks. The entry file
   * names this OS's own; tests name none, so no test reaches a real program.
   */
  readonly programFolders?: readonly string[];
  /**
   * The folder of the console's build, which the engine serves; when left out, or before the
   * console is built, the engine serves no console.
   */
  readonly consoleFolder?: string;
  /**
   * The terminal `binference chat` runs in: standard input and output when both are a terminal,
   * else absent, and the chat is refused.
   */
  readonly chatTerminal?: ChatTerminal;
  /** The streams `binference mcp` serves over: the process's stdin and stdout. */
  readonly mcpStdio?: McpStdio;
  /**
   * Only the crash suite's engine sets it, to drive live fills through a forced stop (decision
   * 0210). Left out, as the entry file leaves it, the price watchers price tokens and live auto
   * orders never fill: no config key or variable turns them on.
   */
  readonly testOrders?: TestOrders;
  /**
   * Only the crash suite's engine sets it: the key its own Relay answers sign orders with, in
   * place of Relay's solver, so a forced stop can land during a Relay bridge (decision 0339). Left
   * out, as the entry file leaves it, the bridge takes Relay's solver alone: no config key or
   * variable names another.
   */
  readonly testRelaySolver?: Address;
  /**
   * Only engines a test starts set it: the port the webhook listener binds in place of
   * `engine.webhookPort`, 0 for a free one the system picks, so a test never takes the owner's
   * 7457 (decision 0333). Left out, as the entry file leaves it, the config's port holds.
   */
  readonly webhookPort?: number;
}
