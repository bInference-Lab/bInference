import type { ProtocolClient } from "@binference/client";
import { BinferenceError, type Clock } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import {
  createMemoryAgentDatabase,
  createMemoryChatDeletion,
  createMemoryChatQueueStore,
  createMemoryGoalStore,
  createMemoryHelperStore,
  createMemoryNoteStore,
  createMemorySessionStore,
  createMemoryTranscriptStore,
  createMemoryWriterFence,
  type MemoryAgentDatabase,
} from "@binference/store/testing";
import type { StartLine } from "../control/control-line.schema.js";
import type { RuntimeModelPrice, RuntimeSettings } from "../control/runtime-settings.schema.js";
import type { ContextSource } from "../engine-chat/ports.js";
import { createProtocolContextSource } from "../engine-chat/protocol-context-source.js";
import { createProtocolEngineChat } from "../engine-chat/protocol-engine-chat.js";
import { createProtocolImageReader } from "../engine-chat/protocol-image-reader.js";
import { type TestTool, testToolBox } from "../loop/test-turns.js";
import { turnLimits } from "../loop/turn-run.js";
import type { AgentDatabase } from "../process/agent-database.js";
import { runRuntime } from "../process/run-runtime.js";
import type { EngineLink, RuntimeHost } from "../process/runtime-host.js";
import { agentToolBox, helperToolBox } from "../tools/agent-tools.js";
import type { ToolClient } from "../tools/tool-client.js";
import { createByteChannel } from "./byte-channel.js";
import { nthTestId } from "./memory-agent-stores.js";
import { createMemoryContextSource } from "./memory-context-source.js";
import { createMemoryEngineChat, type MemoryEngineChat } from "./memory-engine-chat.js";
import { createMemoryImageReader } from "./memory-image-reader.js";
import {
  createScriptedTransport,
  createTestChain,
  type ScriptedReply,
  type ScriptedTransport,
} from "./scripted-transport.js";

/**
 * The runtime run in the test's own process, held as the engine holds the real one: its standard
 * input, its standard output, how it ended, and a kill. `tick` makes it write its health now.
 */
export interface InProcessRuntime {
  write(text: string): Promise<void>;
  end(): Promise<void>;
  readonly output: AsyncIterable<Uint8Array>;
  /** Its exit code: 0 after a stop, 1 after a fault, `undefined` after a kill. */
  readonly exited: Promise<number | undefined>;
  kill(): void;
  /** Runs the 10-second timer's work now, as the timer would. */
  tick(): Promise<void>;
  /** Every start line it signed in with. */
  readonly starts: readonly StartLine[];
  /** The settings each turn was set up with, by its agent, in order. */
  readonly setups: readonly { readonly agent: string; readonly settings: RuntimeSettings }[];
  /** The settings it put in force for the process, such as its outbound route, in order. */
  readonly applied: readonly RuntimeSettings[];
  /** The engine's side of chat it signed in to, and the agent database it keeps. */
  readonly engine: MemoryEngineChat;
  readonly database: MemoryAgentDatabase;
  /** The model's transport and the vision model's, with every request they got. */
  readonly transports: { readonly main: ScriptedTransport; readonly vision?: ScriptedTransport };
}

/** How an in-process runtime differs from one that signs in at once. */
export interface InProcessRuntimeOptions {
  /** The workspace files and live facts its turns read; none and a paper agent's when absent. */
  readonly context?: ContextSource;
  /** Its sign-in fails, as the engine refuses an unknown token. */
  readonly refusesSignIn?: boolean;
  /** Its sign-in never ends, so it never writes `ready`. */
  readonly hangsAtSignIn?: boolean;
  /** It reads no line after its first, as a runtime stuck in its work: it never stops by itself. */
  readonly isStuck?: boolean;
  /** The engine's side of chat; a fake engine with one agent, `agt_…01`, by default. */
  readonly engine?: MemoryEngineChat;
  /**
   * Signs in to a real engine instead, with the start line's token: its chat and the agent's own
   * tools go over the client this opens, and `tools` is not read.
   */
  readonly signIn?: (start: StartLine, signal: AbortSignal) => Promise<ProtocolClient>;
  /** The agent database, as a runtime that ran before left it; an empty one by default. */
  readonly database?: MemoryAgentDatabase;
  /** The model's answers, across every turn; none by default. */
  readonly replies?: readonly ScriptedReply[];
  /** What each of the model's calls costs, by its tokens; $0 when absent. */
  readonly price?: RuntimeModelPrice;
  /** The model, `test/model`, takes images as input (decision 0227). */
  readonly readsImages?: boolean;
  /** The vision model's answers, `test/eyes`; no vision model when absent. */
  readonly visionReplies?: readonly ScriptedReply[];
  readonly tools?: readonly TestTool[];
  /** A manual clock by default. */
  readonly clock?: Clock;
}

function memoryDatabase(database: MemoryAgentDatabase): AgentDatabase {
  return {
    fence: createMemoryWriterFence(database),
    sessions: createMemorySessionStore(database),
    transcript: createMemoryTranscriptStore(database),
    queue: createMemoryChatQueueStore(database),
    helpers: createMemoryHelperStore(database),
    goals: createMemoryGoalStore(database),
    notes: createMemoryNoteStore(database),
    deletion: createMemoryChatDeletion(database),
    schemaVersion: 0,
    close: async () => Promise.resolve(),
  };
}

// The test tools reach no engine operation: a call through the link is refused.
const unservedClient: ToolClient = {
  call: async () =>
    Promise.reject(
      new BinferenceError({
        code: "protocol.unknown_op",
        message: "The runtime in the test's process serves no tool call.",
      }),
    ),
};

// A sign-in as the options shape it: to a real engine, at once, refused, or never ending until it
// is abandoned.
async function signIn(
  options: InProcessRuntimeOptions & { readonly engine: MemoryEngineChat },
  start: StartLine,
  signal: AbortSignal,
): Promise<EngineLink> {
  if (options.signIn !== undefined) {
    const client = await options.signIn(start, signal);
    return {
      chat: createProtocolEngineChat(client),
      context: createProtocolContextSource(client),
      images: createProtocolImageReader(client),
      client,
      close: () => client.close(),
    };
  }
  if (options.hangsAtSignIn === true) {
    await new Promise((_, reject) => signal.addEventListener("abort", reject, { once: true }));
  }
  if (options.refusesSignIn === true) {
    throw new Error("The engine refused the token.");
  }
  return {
    chat: options.engine,
    context: options.context ?? createMemoryContextSource(),
    images: createMemoryImageReader(new Map()),
    client: unservedClient,
    close: () => undefined,
  };
}

// The runtime's exit code, settled once by whichever comes first: its end or a kill.
function exitOf(): {
  readonly exited: Promise<number | undefined>;
  readonly exit: (code: number | undefined) => void;
} {
  const holder = { exit: (_code: number | undefined): void => undefined };
  const exited = new Promise<number | undefined>((resolve) => {
    holder.exit = resolve;
  });
  return { exited, exit: (code) => holder.exit(code) };
}

// The model, `test/model`, that answers the options' replies, and the vision model, `test/eyes`,
// when the options give its answers.
function testModels(options: InProcessRuntimeOptions, clock: Clock) {
  const transport = createScriptedTransport(options.replies ?? []);
  const price = options.price === undefined ? {} : { price: options.price };
  const reads = options.readsImages === true ? { readsImages: true as const } : {};
  const models = createTestChain([{ name: "test/model", transport, ...price, ...reads }], {
    clock,
  });
  if (options.visionReplies === undefined) {
    return { models, transports: { main: transport } };
  }
  const eyes = createScriptedTransport(options.visionReplies);
  const model = { name: "test/eyes", transport: eyes, readsImages: true as const };
  const vision = createTestChain([model], { clock });
  return { models, vision, transports: { main: transport, vision: eyes } };
}

// What the runtime set up its turns with and put in force for itself, in order.
interface Recorded {
  readonly setups: { readonly agent: string; readonly settings: RuntimeSettings }[];
  readonly applied: RuntimeSettings[];
}

// The agent database, the model and the tools of the runtime's chat, its clock, and the record
// of the settings it applied.
function chatHost(
  options: InProcessRuntimeOptions,
  database: MemoryAgentDatabase,
  recorded: Recorded,
): Pick<RuntimeHost, "openAgentDatabase" | "turnSetup" | "applySettings" | "clock" | "random"> & {
  readonly transports: InProcessRuntime["transports"];
} {
  const tools = testToolBox(options.tools ?? []);
  const isLinked = options.signIn !== undefined;
  const clock = options.clock ?? createManualClock(10_000);
  const { models, vision, transports } = testModels(options, clock);
  return {
    transports,
    openAgentDatabase: async () => memoryDatabase(database),
    turnSetup: (place, settings, { client, helpers, goals }) => {
      const { agent } = place;
      recorded.setups.push({ agent, settings });
      const parts = {
        agent,
        client,
        turn: place,
        ...(helpers === undefined ? {} : { helpers }),
        ...(goals === undefined ? {} : { goals }),
      };
      const linked = place.helper === undefined ? agentToolBox(parts) : helperToolBox(parts);
      return {
        models,
        ...(vision === undefined ? {} : { vision }),
        tools: isLinked ? linked : tools,
        instructions: "You are a test agent.",
        limits: turnLimits,
      };
    },
    applySettings: (settings) => {
      recorded.applied.push(settings);
    },
    clock,
    random: createSeededRandom(7),
  };
}

// The exit code once the runtime's loop ends, 0 after a stop; its output ends with it.
function settleExit(
  running: ReturnType<typeof runRuntime>,
  killed: ReturnType<typeof exitOf>,
  output: { readonly end: () => void },
): void {
  void running.then(
    (exit) => killed.exit(exit === "stopped" ? 0 : 1),
    () => killed.exit(1),
  );
  void killed.exited.then(() => output.end());
}

/** Starts the runtime's main loop in this process, on channels in place of pipes. */
export function startInProcessRuntime(options: InProcessRuntimeOptions = {}): InProcessRuntime {
  const engine = options.engine ?? createMemoryEngineChat([nthTestId("agt", 1)]);
  const database = options.database ?? createMemoryAgentDatabase();
  const [input, output] = [createByteChannel(), createByteChannel()];
  const timer = { onTick: async (): Promise<void> => Promise.resolve() };
  const [starts, setups]: [StartLine[], { agent: string; settings: RuntimeSettings }[]] = [[], []];
  const state = { hasStarted: false };
  const applied: RuntimeSettings[] = [];
  const killed = exitOf();
  const { transports, ...host } = chatHost(options, database, { setups, applied });
  const running = runRuntime({
    input,
    write: async (line) => output.push(`${line}\n`),
    connect: async (start, signal) => {
      starts.push(start);
      return signIn({ ...options, engine }, start, signal);
    },
    ...host,
    everyTenSeconds: (onTick, signal) => {
      timer.onTick = onTick;
      signal.addEventListener("abort", () => (timer.onTick = async () => Promise.resolve()), {
        once: true,
      });
    },
    version: "test",
  });
  settleExit(running, killed, output);
  return {
    write: async (text) => {
      if (options.isStuck !== true || !state.hasStarted) {
        input.push(text);
        state.hasStarted = true;
      }
    },
    end: async () => input.end(),
    output,
    exited: killed.exited,
    kill() {
      input.end();
      killed.exit(undefined);
    },
    tick: async () => timer.onTick(),
    engine,
    database,
    starts,
    setups,
    applied,
    transports,
  };
}
