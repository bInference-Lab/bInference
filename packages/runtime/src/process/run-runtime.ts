import { BinferenceError, type Clock } from "@binference/core";
import type { TurnSetup } from "../chats/chat-context.js";
import {
  answerMessagesRoute,
  isMessagesRoute,
  type MessageRouteParts,
} from "../chats/message-routes.js";
import {
  type EngineLine,
  engineLineSchema,
  type RouteLine,
  type RuntimeLine,
  type StartLine,
} from "../control/control-line.schema.js";
import { readControlLines } from "../control/read-control-lines.js";
import type { RuntimeSettings } from "../control/runtime-settings.schema.js";
import { answerNoteRoute, isNoteRoute, type NoteRouteParts } from "../notes/note-routes.js";
import type { ContextSource, EngineChat, OwnerImageReader } from "../relay/ports.js";
import type { TurnPlace } from "../sessions/turn-place.js";
import type { ToolClient } from "../tools/tool-client.js";
import type { AgentDatabase } from "./agent-database.js";
import { type PreparedChat, prepareChat, type RuntimeChat, startChat } from "./runtime-chat.js";

/** The runtime's signed-in link to the engine. */
export interface EngineLink {
  /** The engine's side of chat over this connection. */
  readonly chat: EngineChat;
  /** The workspace files and live facts each turn's context reads over this connection. */
  readonly context: ContextSource;
  /** The images of the owner's messages, which a turn reads over this connection. */
  readonly images: OwnerImageReader;
  /** The operations the agents' tools call over this connection. */
  readonly client: ToolClient;
  /** Closes the connection; the runtime holds no other. */
  close(): void;
}

/** What the runtime's entry hands over from Node: its pipes, how it reaches the engine, its timer. */
export interface RuntimeHost {
  /** The standard input: the engine's lines. */
  readonly input: AsyncIterable<Uint8Array>;
  /** Writes one line to the standard output, and resolves once it is written. */
  readonly write: (line: string) => Promise<void>;
  /** Signs in to the engine at the start line's endpoint with its token. */
  readonly connect: (start: StartLine, signal: AbortSignal) => Promise<EngineLink>;
  /** Opens `agent.sqlite` at the start line's path and migrates it. */
  readonly openAgentDatabase: (path: string, signal: AbortSignal) => Promise<AgentDatabase>;
  /**
   * What an agent's next turn runs with under the settings in force, its tools calling the engine
   * through the given client for the place the turn runs in.
   */
  readonly turnSetup: (
    place: TurnPlace,
    settings: RuntimeSettings,
    client: ToolClient,
  ) => TurnSetup;
  readonly clock: Clock;
  /** Calls `onTick` every 10 seconds until the signal aborts: when the runtime writes its health. */
  readonly everyTenSeconds: (onTick: () => Promise<void>, signal: AbortSignal) => void;
  /** This build's release. */
  readonly version: string;
}

/**
 * How the runtime ended: `stopped` on the engine's `stop` or the end of its input; any other is a
 * fault, after which the engine starts it again.
 */
export type RuntimeExit = "stopped" | "bad_start" | "bad_line" | "not_connected" | "no_database";

const connectTimeoutMs = 20_000;

function encode(line: RuntimeLine): string {
  return JSON.stringify(line);
}

function parseLine(text: string): EngineLine | undefined {
  try {
    const parsed = engineLineSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

// A routed operation the runtime does not serve yet is refused as one it does not know.
function refusedRoute(route: RouteLine): RuntimeLine {
  return {
    t: "routeReply",
    id: route.id,
    error: {
      code: "protocol.unknown_op",
      message: `The agent runtime does not serve ${route.op}.`,
      retryable: false,
    },
  };
}

async function writeHealth(
  host: RuntimeHost,
  chat: RuntimeChat,
  signal: AbortSignal,
): Promise<void> {
  const counts = await chat.runner.counts(signal);
  await host.write(encode({ t: "health", ...counts }));
}

type NextLine = IteratorResult<string, undefined>;

/** What the runtime answers the engine's lines after the start with. */
interface LineContext {
  readonly apply: (settings: RuntimeSettings) => void;
  readonly notes: NoteRouteParts;
  readonly messages: MessageRouteParts;
  readonly lifetime: AbortSignal;
}

async function answerRoute(route: RouteLine, context: LineContext): Promise<RuntimeLine> {
  if (isMessagesRoute(route)) {
    return answerMessagesRoute(route, context.messages, context.lifetime);
  }
  return isNoteRoute(route)
    ? answerNoteRoute(route, context.notes, context.lifetime)
    : refusedRoute(route);
}

// Answers one line after the start; answers how the runtime ends when the line ends it.
async function answer(
  host: RuntimeHost,
  text: string,
  context: LineContext,
): Promise<RuntimeExit | undefined> {
  const line = parseLine(text);
  if (line === undefined || line.t === "start") {
    return "bad_line";
  }
  if (line.t === "stop") {
    return "stopped";
  }
  if (line.t === "settings") {
    context.apply(line.settings);
  } else {
    await host.write(encode(await answerRoute(line, context)));
  }
  return undefined;
}

// Answers each line after the start until `stop` or the end of the input, from the line that was
// read while the runtime signed in. New settings apply from the next turn and merge point on.
async function serve(
  host: RuntimeHost,
  lines: AsyncIterator<string>,
  context: LineContext & { readonly read: NextLine },
): Promise<RuntimeExit> {
  const ended =
    context.read.done === true ? "stopped" : await answer(host, context.read.value, context);
  if (ended !== undefined) {
    return ended;
  }
  for await (const text of { [Symbol.asyncIterator]: () => lines }) {
    const exit = await answer(host, text, context);
    if (exit !== undefined) {
      return exit;
    }
  }
  return "stopped";
}

async function connect(
  host: RuntimeHost,
  start: StartLine,
  signal: AbortSignal,
): Promise<EngineLink | undefined> {
  try {
    return await host.connect(
      start,
      AbortSignal.any([signal, AbortSignal.timeout(connectTimeoutMs)]),
    );
  } catch {
    return undefined;
  }
}

function endsRuntime(read: NextLine): boolean {
  return read.done === true || parseLine(read.value)?.t === "stop";
}

// Signs in while it reads on: the engine's stop, or the end of the input when the engine went
// away, ends the sign-in at once.
async function signIn(host: RuntimeHost, start: StartLine, reading: Promise<NextLine>) {
  const abandon = new AbortController();
  const connecting = connect(host, start, abandon.signal);
  const isQuit = await Promise.race([connecting.then(() => false), reading.then(endsRuntime)]);
  if (isQuit) {
    abandon.abort();
    (await connecting)?.close();
    return "quit";
  }
  return connecting;
}

async function openAgentDatabase(
  host: RuntimeHost,
  start: StartLine,
  signal: AbortSignal,
): Promise<AgentDatabase | undefined> {
  try {
    return await host.openAgentDatabase(start.paths.agentDb, signal);
  } catch {
    return undefined;
  }
}

/** What the runtime holds once it is connected. */
interface Connected {
  readonly start: StartLine;
  readonly lines: AsyncIterator<string>;
  readonly reading: Promise<NextLine>;
  readonly link: EngineLink;
  readonly prepared: PreparedChat;
  readonly database: AgentDatabase;
  readonly lifetime: AbortSignal;
}

// Starts the chat, writes `ready` and the health, and serves the engine's lines; on the way out
// it ends every running turn as the runtime's stop, keeping the waiting messages.
async function serveConnected(host: RuntimeHost, connected: Connected): Promise<RuntimeExit> {
  const { lifetime } = connected;
  const settings = { current: connected.start.settings };
  const chat = await startChat({
    prepared: connected.prepared,
    engine: connected.link.chat,
    turnContext: connected.link.context,
    images: connected.link.images,
    settings: () => settings.current,
    setup: (place, current) => host.turnSetup(place, current, connected.link.client),
    clock: host.clock,
    lifetime,
  });
  try {
    const { schemaVersion } = connected.database;
    await host.write(encode({ t: "ready", version: host.version, schemaVersion }));
    host.everyTenSeconds(async () => writeHealth(host, chat, lifetime), lifetime);
    const apply = (next: RuntimeSettings): void => {
      settings.current = next;
    };
    const { database, prepared } = connected;
    const notes = { notes: database.notes, fence: prepared.stores.fence, clock: host.clock };
    const messages = { sessions: prepared.stores.sessions, transcript: prepared.stores.transcript };
    const context = { apply, notes, messages, lifetime, read: await connected.reading };
    return await serve(host, connected.lines, context);
  } finally {
    chat.unwatch();
    await chat.runner.stop();
  }
}

// Opens and prepares `agent.sqlite`, signs in, and serves until the runtime ends.
async function runStarted(
  host: RuntimeHost,
  lines: AsyncIterator<string>,
  start: StartLine,
): Promise<RuntimeExit> {
  const lifetime = new AbortController();
  const database = await openAgentDatabase(host, start, lifetime.signal);
  if (database === undefined) {
    return "no_database";
  }
  try {
    const prepared = await prepareChat(database, { clock: host.clock, signal: lifetime.signal });
    const reading = lines.next();
    const link = await signIn(host, start, reading);
    if (link === "quit" || link === undefined) {
      return link === "quit" ? "stopped" : "not_connected";
    }
    try {
      const connected = { start, lines, reading, link, prepared, database };
      return await serveConnected(host, { ...connected, lifetime: lifetime.signal });
    } finally {
      link.close();
    }
  } finally {
    lifetime.abort();
    await database.close();
  }
}

/**
 * Runs the agent runtime on its pipes (runtime spec, section 2.1): reads the `start` line, opens
 * and migrates `agent.sqlite`, takes the writer fence and repairs every turn a crash left
 * unfinished, signs in to the engine with the token it holds, starts its chat, writes `ready`,
 * then its health every 10 seconds, and answers each line until `stop` or the end of its input,
 * which also end a sign-in under way. A first line that is not `start`, a line it cannot read, an
 * agent database it cannot open or a sign-in that fails ends it with a fault; the engine starts it
 * again.
 */
export async function runRuntime(host: RuntimeHost): Promise<RuntimeExit> {
  const lines = readControlLines(host.input)[Symbol.asyncIterator]();
  try {
    const first = await lines.next();
    const start = first.done === true ? undefined : parseLine(first.value);
    if (start?.t !== "start") {
      return "bad_start";
    }
    return await runStarted(host, lines, start);
  } catch (error) {
    if (error instanceof BinferenceError && error.code === "runtime.line_too_long") {
      return "bad_line";
    }
    throw error;
  } finally {
    // A read may still wait for the engine's next line: the reader ends when the input does.
    void lines.return?.(undefined);
  }
}
