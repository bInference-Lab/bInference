import { BinferenceError, createIdSource } from "@binference/core";
import type { TurnSetup } from "../chats/chat-context.js";
import {
  type EngineLine,
  engineLineSchema,
  type RuntimeLine,
  type StartLine,
} from "../control/control-line.schema.js";
import { readControlLines } from "../control/read-control-lines.js";
import type { RuntimeSettings } from "../control/runtime-settings.schema.js";
import { createGoalDesk, type GoalDesk } from "../goals/goal-desk.js";
import { type BudgetMemory, createBudgetMemory } from "../helpers/budget-memory.js";
import { createHelperDesk, type HelperRunner } from "../helpers/helper-desk.js";
import { offersListedTools } from "../listed-mcp/listed-mcp-tools.js";
import { createChatStatusSources } from "../sessions/chat-status-sources.js";
import type { TurnPlace } from "../sessions/turn-place.js";
import type { HelperToolParts } from "../tools/helper-tools.js";
import type { AgentDatabase } from "./agent-database.js";
import { answerRoute, type RouteParts } from "./answer-route.js";
import { type PreparedChat, prepareChat, type RuntimeChat, startChat } from "./runtime-chat.js";
import type { EngineLink, RuntimeHost } from "./runtime-host.js";

/**
 * How the runtime ended: `stopped` on the engine's `stop` or the end of its input; any other is a
 * fault, after which the engine starts it again.
 */
export type RuntimeExit = "stopped" | "bad_start" | "bad_line" | "not_connected" | "no_database";

const connectTimeoutMs = 20_000;

// The listed servers' states one health line names at most.
const maxHealthStates = 64;

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

async function writeHealth(
  host: RuntimeHost,
  chat: RuntimeChat,
  signal: AbortSignal,
): Promise<void> {
  const counts = await chat.runner.counts(signal);
  const listedMcp = (host.listedMcpStates?.() ?? []).slice(0, maxHealthStates);
  await host.write(
    encode({ t: "health", ...counts, ...(listedMcp.length === 0 ? {} : { listedMcp }) }),
  );
}

type NextLine = IteratorResult<string, undefined>;

/** What the runtime answers the engine's lines after the start with. */
interface LineContext extends RouteParts {
  readonly apply: (settings: RuntimeSettings) => void;
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
    // The engine's switch of listed servers waits for this before it turns an agent off.
    await host.write(encode({ t: "settingsTaken", seq: line.seq }));
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

/** How one start sets up every turn, the agents' and their helpers', and the helpers' desk. */
interface Turns {
  readonly setup: (place: TurnPlace) => TurnSetup;
  readonly helpers: HelperRunner;
  readonly budgets: BudgetMemory;
  readonly goals: GoalDesk;
}

// Every turn runs under the settings in force, and starts marked while a community plugin offers
// tools (decision 0350). An agent's tools reach its helpers; a helper's turn gets no helper tools,
// so it starts no helper (decision 0403).
function turnsOf(host: RuntimeHost, connected: Connected, settings: () => RuntimeSettings): Turns {
  const budgets = createBudgetMemory();
  const { link, prepared, database, lifetime } = connected;
  const holder: { helpers?: HelperToolParts } = {};
  const chats = createChatStatusSources({ stores: prepared.stores, budgets });
  const { fence } = prepared.stores;
  const goals = createGoalDesk({
    goals: database.goals,
    fence,
    client: link.client,
    clock: host.clock,
  });
  const setup = (place: TurnPlace): TurnSetup => {
    const current = settings();
    const isAgent = place.helper === undefined;
    const helpers = isAgent ? holder.helpers : undefined;
    const turnLink = {
      client: link.client,
      chats: isAgent ? chats.agent : chats.helper,
      ...(helpers === undefined ? {} : { helpers }),
      ...(isAgent ? { goals: { desk: goals } } : {}),
    };
    return {
      ...host.turnSetup(place, current, turnLink),
      hasOutsideTools:
        (current.plugins ?? []).some(({ tools }) => tools.length > 0) ||
        offersListedTools(current.listedMcp ?? [], place.agent),
    };
  };
  const helpers = createHelperDesk({
    stores: prepared.stores,
    helpers: database.helpers,
    engine: link.chat,
    context: link.context,
    client: link.client,
    setup,
    budgets,
    clock: host.clock,
    ids: createIdSource({ clock: host.clock, random: host.random }),
    lifetime,
    providers: () => Object.keys(settings().models.providers),
  });
  holder.helpers = { desk: helpers, clock: host.clock };
  return { setup, helpers, budgets, goals };
}

// Starts the chat of one start, its turns set up under the settings in force.
async function chatOf(
  host: RuntimeHost,
  connected: Connected,
  parts: { readonly turns: Turns; readonly settings: { readonly current: RuntimeSettings } },
): Promise<RuntimeChat> {
  const { turns, settings } = parts;
  return startChat({
    prepared: connected.prepared,
    engine: connected.link.chat,
    turnContext: connected.link.context,
    images: connected.link.images,
    settings: () => settings.current,
    setup: (place) => turns.setup(place),
    clock: host.clock,
    logger: host.logger,
    lifetime: connected.lifetime,
    helpers: turns.helpers,
    budgets: turns.budgets,
    goals: turns.goals,
  });
}

// Starts the chat, writes `ready` and the health, and serves the engine's lines; on the way out
// it ends every running turn as the runtime's stop, keeping the waiting messages.
async function serveConnected(host: RuntimeHost, connected: Connected): Promise<RuntimeExit> {
  const { lifetime } = connected;
  const settings = { current: connected.start.settings };
  host.applySettings?.(settings.current);
  const turns = turnsOf(host, connected, () => settings.current);
  const chat = await chatOf(host, connected, { turns, settings });
  try {
    const { schemaVersion } = connected.database;
    await host.write(encode({ t: "ready", version: host.version, schemaVersion }));
    host.everyTenSeconds(async () => writeHealth(host, chat, lifetime), lifetime);
    const apply = (next: RuntimeSettings): void => {
      settings.current = next;
      host.applySettings?.(next);
    };
    const { database, prepared } = connected;
    const notes = { notes: database.notes, fence: prepared.stores.fence, clock: host.clock };
    const messages = { sessions: prepared.stores.sessions, transcript: prepared.stores.transcript };
    const goals = {
      desk: turns.goals,
      sessions: prepared.stores.sessions,
      fence: prepared.stores.fence,
      clock: host.clock,
      follow: (goalChat: Parameters<RuntimeChat["runner"]["followGoal"]>[0]) =>
        void chat.runner.followGoal(goalChat).catch(() => undefined),
    };
    const deletion = {
      runner: chat.runner,
      deletion: database.deletion,
      fence: prepared.stores.fence,
    };
    const read = await connected.reading;
    const context = { apply, notes, messages, goals, deletion, lifetime, read };
    return await serve(host, connected.lines, context);
  } finally {
    chat.unwatch();
    await Promise.all([chat.runner.stop(), turns.helpers.stopAll()]);
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
