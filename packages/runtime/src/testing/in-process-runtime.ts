import type { Clock } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import {
  createMemoryAgentDatabase,
  createMemoryChatQueueStore,
  createMemorySessionStore,
  createMemoryTranscriptStore,
  createMemoryWriterFence,
  type MemoryAgentDatabase,
} from "@binference/store/testing";
import type { StartLine } from "../control/control-line.schema.js";
import { type TestTool, testToolBox } from "../loop/test-turns.js";
import { turnLimits } from "../loop/turn-run.js";
import type { AgentDatabase } from "../process/agent-database.js";
import { type EngineLink, type RuntimeHost, runRuntime } from "../process/run-runtime.js";
import { createByteChannel } from "./byte-channel.js";
import { nthTestId } from "./memory-agent-stores.js";
import { createMemoryEngineChat, type MemoryEngineChat } from "./memory-engine-chat.js";
import { createScriptedTransport, type ScriptedReply } from "./scripted-transport.js";

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
  /** The engine's side of chat it signed in to, and the agent database it keeps. */
  readonly engine: MemoryEngineChat;
  readonly database: MemoryAgentDatabase;
}

/** How an in-process runtime differs from one that signs in at once. */
export interface InProcessRuntimeOptions {
  /** Its sign-in fails, as the engine refuses an unknown token. */
  readonly refusesSignIn?: boolean;
  /** Its sign-in never ends, so it never writes `ready`. */
  readonly hangsAtSignIn?: boolean;
  /** It reads no line after its first, as a runtime stuck in its work: it never stops by itself. */
  readonly isStuck?: boolean;
  /** The engine's side of chat; a fake engine with one agent, `agt_…01`, by default. */
  readonly engine?: MemoryEngineChat;
  /** The agent database, as a runtime that ran before left it; an empty one by default. */
  readonly database?: MemoryAgentDatabase;
  /** The model's answers, across every turn; none by default. */
  readonly replies?: readonly ScriptedReply[];
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
    schemaVersion: 0,
    close: async () => Promise.resolve(),
  };
}

// A sign-in as the options shape it: at once, refused, or never ending until it is abandoned.
async function signIn(
  options: InProcessRuntimeOptions & { readonly engine: MemoryEngineChat },
  signal: AbortSignal,
): Promise<EngineLink> {
  if (options.hangsAtSignIn === true) {
    await new Promise((_, reject) => signal.addEventListener("abort", reject, { once: true }));
  }
  if (options.refusesSignIn === true) {
    throw new Error("The engine refused the token.");
  }
  return { chat: options.engine, close: () => undefined };
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

// The agent database, the model and the tools of the runtime's chat, and its clock.
function chatHost(
  options: InProcessRuntimeOptions,
  database: MemoryAgentDatabase,
): Pick<RuntimeHost, "openAgentDatabase" | "turnSetup" | "clock"> {
  const transport = createScriptedTransport(options.replies ?? []);
  const tools = testToolBox(options.tools ?? []);
  return {
    openAgentDatabase: async () => memoryDatabase(database),
    turnSetup: () => ({
      transport,
      tools,
      instructions: "You are a test agent.",
      limits: turnLimits,
    }),
    clock: options.clock ?? createManualClock(10_000),
  };
}

/** Starts the runtime's main loop in this process, on channels in place of pipes. */
export function startInProcessRuntime(options: InProcessRuntimeOptions = {}): InProcessRuntime {
  const engine = options.engine ?? createMemoryEngineChat([nthTestId("agt", 1)]);
  const database = options.database ?? createMemoryAgentDatabase();
  const input = createByteChannel();
  const output = createByteChannel();
  const timer = { onTick: async (): Promise<void> => Promise.resolve() };
  const starts: StartLine[] = [];
  const state = { hasStarted: false };
  const killed = exitOf();
  const running = runRuntime({
    input,
    write: async (line) => output.push(`${line}\n`),
    connect: async (start, signal) => {
      starts.push(start);
      return signIn({ ...options, engine }, signal);
    },
    ...chatHost(options, database),
    everyTenSeconds: (onTick, signal) => {
      timer.onTick = onTick;
      signal.addEventListener("abort", () => (timer.onTick = async () => Promise.resolve()), {
        once: true,
      });
    },
    version: "test",
  });
  void running.then(
    (exit) => killed.exit(exit === "stopped" ? 0 : 1),
    () => killed.exit(1),
  );
  void killed.exited.then(() => output.end());
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
  };
}
