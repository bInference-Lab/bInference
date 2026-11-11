import type { NameResolver } from "@binference/chain";
import type { Clock, IdSource, Logger } from "@binference/core";
import type { ShellStopper } from "@binference/protocol";
import type { EngineBrowser } from "../browse/browser-handlers.js";
import type { PdfReader } from "../documents/ports.js";
import { createFileHandlers, type EngineFiles, type FileHandlers } from "../files/file-handlers.js";
import { createNameHandlers, type NameHandlers } from "../names/name-handlers.js";
import type { ConfigJournal } from "../ports.js";
import type { ScreenCapture } from "../screen/ports.js";
import type { LocalVoice } from "../speech/ports.js";
import { type AllowedHandlers, createAllowedHandlers } from "./allowed-handlers.js";
import type { CommandRunner, ShellStore } from "./ports.js";
import { createShellAnswerHandlers, lapse, type ShellAnswerHandlers } from "./shell-answers.js";
import type { ShellContext, ShellWakeParts } from "./shell-context.js";
import { hearEnd, stopAgentShell, tellLostJobs } from "./shell-ends.js";
import { createShellHandlers, type ShellHandlers } from "./shell-handlers.js";
import { createShellJobs } from "./shell-jobs.js";
import type { ShellSettings } from "./shell-policy.js";
import { createShellRequests, type OpenShellRequest } from "./shell-requests.js";

/**
 * The agent's shell as the composition root gives it (decision 0378): the runner on this machine,
 * the owner's settings as they are now, and the log its ends go to. Without it the shell is off.
 */
export interface EngineShell {
  readonly runner: CommandRunner;
  readonly settings: () => ShellSettings;
  readonly logger?: Logger;
  /** The agent's files on this machine (decision 0386); without them every file call refuses. */
  readonly files?: EngineFiles;
  /** The agent's browser on this machine (decision 0401); without it `browser/run` is off. */
  readonly browser?: EngineBrowser;
  /** What reads the PDFs the agent reads on this machine (decision 0402); without it none is read. */
  readonly pdfReader?: PdfReader;
  /** The machine's own voice (decision 0405); without it the agent speaks only through a model. */
  readonly voice?: LocalVoice;
  /** The owner's screen (decision 0406); without it the agent cannot look at it. */
  readonly screen?: ScreenCapture;
}

/** Every handler of the agent's shell and of the owner's answers to it. */
export interface ShellPartHandlers extends ShellHandlers, ShellAnswerHandlers, AllowedHandlers {}

/**
 * The agent's shell in the engine (decisions 0378 and 0409): its handlers, the stop the owner's
 * `chat/stop` and a freeze make, and the start's telling of the commands the last stop lost.
 */
export interface ShellPart {
  readonly handlers: ShellPartHandlers;
  /** Stops every command of an agent, or of every agent, and closes its open request. */
  stop(agent: string | undefined, by: Exclude<ShellStopper, "agent">): void;
  /** Tells each agent of a command the last stop of the engine lost; answers how many. */
  tellLost(options: { readonly signal: AbortSignal }): Promise<number>;
}

const off: ShellSettings = {
  run: "off",
  ask: "never",
  onNoAnswer: "refuse",
  timeoutSeconds: 0,
  tellOnQuietEnd: false,
};

/** What the shell is made from: the machine's shell, its rows, the journal and the chat's parts. */
interface ShellPartOptions {
  readonly shell?: EngineShell;
  readonly store: ShellStore;
  readonly journal: ConfigJournal;
  readonly wakeParts: ShellWakeParts;
}

// The jobs and the open requests, whose ends and lapses reach the context once it is made.
function memoryOf(options: ShellPartOptions, contextOf: () => ShellContext | undefined) {
  const { shell, wakeParts } = options;
  const { clock, ids } = wakeParts;
  const jobs = createShellJobs({
    clock,
    ids,
    ...(shell?.logger === undefined ? {} : { logger: shell.logger }),
    mask: shell === undefined ? (text) => text : (text) => shell.runner.mask(text),
    ended: (job) => {
      const context = contextOf();
      if (context !== undefined) {
        hearEnd(context, job);
      }
    },
  });
  const requests = createShellRequests({
    clock,
    lapsed: (request: OpenShellRequest) => {
      const context = contextOf();
      if (context !== undefined) {
        lapse(context, request);
      }
    },
  });
  return { jobs, requests };
}

/**
 * Creates the agent's shell over the chat's parts: the jobs in memory, whose ends are told; the
 * open requests, whose time runs out as `shell.onNoAnswer` says; and the rows the store keeps.
 */
export function createShellPart(options: ShellPartOptions): ShellPart {
  const { shell, store, journal, wakeParts } = options;
  const { clock, ids, publish } = wakeParts;
  const late: { context?: ShellContext } = {};
  const context: ShellContext = {
    ...(shell === undefined ? {} : { runner: shell.runner }),
    ...(shell?.logger === undefined ? {} : { logger: shell.logger }),
    settings: shell?.settings ?? (() => off),
    ...memoryOf(options, () => late.context),
    store,
    wakeParts,
    allowed: { store, journal, publish, ids, clock },
    clock,
    ids,
    left: new Map(),
  };
  late.context = context;
  return {
    handlers: {
      ...createShellHandlers(context),
      ...createShellAnswerHandlers(context),
      ...createAllowedHandlers(context.allowed),
    },
    stop: (agent, by) => {
      stopAgentShell(context, agent, by);
    },
    tellLost: async (call) => tellLostJobs(context, call),
  };
}

/**
 * The handlers of the agent's lookups of the machine and the chain's names: the file operations
 * and `name/resolve`.
 */
export function machineHandlersOf(options: {
  readonly shell?: EngineShell;
  readonly nameResolvers?: readonly NameResolver[];
  readonly clock: Clock;
  readonly ids: IdSource;
}): FileHandlers & NameHandlers {
  const { nameResolvers, clock } = options;
  return {
    ...createNameHandlers({ resolvers: nameResolvers ?? [], clock }),
    ...createFileHandlers(options.shell?.files),
  };
}
