import { BinferenceError } from "@binference/core";
import {
  type EngineLine,
  engineLineSchema,
  type RouteLine,
  type RuntimeLine,
  type StartLine,
} from "../control/control-line.schema.js";
import { readControlLines } from "../control/read-control-lines.js";
import type { RuntimeSettings } from "../control/runtime-settings.schema.js";

/** The runtime's signed-in link to the engine. */
export interface EngineLink {
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
  /** Calls `onTick` every 10 seconds until the signal aborts: when the runtime writes its health. */
  readonly everyTenSeconds: (onTick: () => Promise<void>, signal: AbortSignal) => void;
  /** This build's release. */
  readonly version: string;
}

/**
 * How the runtime ended: `stopped` on the engine's `stop` or the end of its input; any other is a
 * fault, after which the engine starts it again.
 */
export type RuntimeExit = "stopped" | "bad_start" | "bad_line" | "not_connected";

// The agent database is not opened yet: it has no schema version to report.
const noSchemaVersion = 0;
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

// The runtime serves no routed operation yet: each one is refused as one it does not know.
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

async function writeHealth(host: RuntimeHost): Promise<void> {
  await host.write(encode({ t: "health", runningTurns: 0, waitingMessages: 0 }));
}

type NextLine = IteratorResult<string, undefined>;

// Answers one line after the start; answers how the runtime ends when the line ends it.
async function answer(
  host: RuntimeHost,
  text: string,
  apply: (settings: RuntimeSettings) => void,
): Promise<RuntimeExit | undefined> {
  const line = parseLine(text);
  if (line === undefined || line.t === "start") {
    return "bad_line";
  }
  if (line.t === "stop") {
    return "stopped";
  }
  if (line.t === "settings") {
    apply(line.settings);
  } else {
    await host.write(encode(refusedRoute(line)));
  }
  return undefined;
}

// Answers each line after the start until `stop` or the end of the input, from the line that was
// read while the runtime signed in.
async function serve(
  host: RuntimeHost,
  lines: AsyncIterator<string>,
  context: { readonly start: StartLine; readonly read: NextLine },
): Promise<RuntimeExit> {
  const running = { settings: context.start.settings };
  // New settings apply from the next model call on.
  const apply = (settings: RuntimeSettings): void => {
    running.settings = settings;
  };
  const ended =
    context.read.done === true ? "stopped" : await answer(host, context.read.value, apply);
  if (ended !== undefined) {
    return ended;
  }
  for await (const text of { [Symbol.asyncIterator]: () => lines }) {
    const exit = await answer(host, text, apply);
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

/**
 * Runs the agent runtime on its pipes (runtime spec, section 2): reads the `start` line, signs in
 * to the engine with the token it holds, writes `ready`, then its health every 10 seconds, and
 * answers each line until `stop` or the end of its input, which also end a sign-in under way. A
 * first line that is not `start`, a line it cannot read, or a sign-in that fails ends it with a
 * fault; the engine starts it again.
 */
export async function runRuntime(host: RuntimeHost): Promise<RuntimeExit> {
  const lines = readControlLines(host.input)[Symbol.asyncIterator]();
  try {
    const first = await lines.next();
    const start = first.done === true ? undefined : parseLine(first.value);
    if (start?.t !== "start") {
      return "bad_start";
    }
    const reading = lines.next();
    const link = await signIn(host, start, reading);
    if (link === "quit") {
      return "stopped";
    }
    if (link === undefined) {
      return "not_connected";
    }
    const lifetime = new AbortController();
    try {
      await host.write(
        encode({ t: "ready", version: host.version, schemaVersion: noSchemaVersion }),
      );
      host.everyTenSeconds(async () => writeHealth(host), lifetime.signal);
      return await serve(host, lines, { start, read: await reading });
    } finally {
      lifetime.abort();
      link.close();
    }
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
