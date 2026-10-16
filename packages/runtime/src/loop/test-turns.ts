import { type JsonValue, jsonValueSchema } from "@binference/core";
import { createManualClock, type ManualClock } from "@binference/core/testing";
import type { Locale } from "@binference/protocol";
import { createRelayLiveFacts } from "../relay/relay-live-facts.js";
import { messagesOf, type StoredHistory } from "../sessions/conversation.js";
import { nthTestId } from "../testing/memory-agent-stores.js";
import { createMemoryContextSource } from "../testing/memory-context-source.js";
import {
  createScriptedTransport,
  createTestChain,
  oneModelChain,
  type ScriptedReply,
  type ScriptedTransport,
} from "../testing/scripted-transport.js";
import {
  createTurnRecorder,
  type TurnRecorder,
  type TurnRecorderOptions,
} from "../testing/turn-recorder.js";
import type { ModelPrice } from "../usage/model-price.js";
import { type ChatTurn, type ChatTurnOptions, createChatTurn } from "./chat-turn.js";
import type { ModelMessage, OwnerMessage } from "./model-message.js";
import type { LiveFactsReader, ModelChain, ToolBox, TurnEngine } from "./ports.js";
import type { ReadImage, ToolKind, ToolOutcome, ToolRunContext } from "./turn-records.js";
import { type TurnLimits, turnLimits, type TurnParts } from "./turn-run.js";

/** The turn id every test turn runs under. */
export const testTurnId = "trn_0190f1c2-3a4b-7c5d-8e6f-000000000001";

// The agent every test turn runs for.
const testAgent = nthTestId("agt", 1);

/** A tool of a test's tool box; it answers `ran <name>` unless it runs its own body. */
export interface TestTool {
  readonly name: string;
  readonly kind: ToolKind;
  readonly parallel?: boolean;
  readonly outside?: boolean;
  readonly asksOwner?: boolean;
  readonly run?: (context: ToolRunContext, args: JsonValue) => Promise<ToolOutcome>;
}

function parseArguments(text: string): JsonValue | undefined {
  try {
    const parsed = jsonValueSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** A tool box over test tools: an unknown name or arguments that are not JSON are refused. */
export function testToolBox(tools: readonly TestTool[]): ToolBox {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return {
    declarations: tools.map((tool) => ({
      name: tool.name,
      description: tool.name,
      parameters: {},
    })),
    prepare(call) {
      const tool = byName.get(call.name);
      const args = parseArguments(call.argumentsText);
      if (tool === undefined || args === undefined) {
        return { ready: false, text: `refused ${call.name}` };
      }
      const body = tool.run ?? (async () => ({ text: `ran ${tool.name}`, isError: false }));
      return {
        ready: true,
        kind: tool.kind,
        parallel: tool.parallel === true,
        outside: tool.outside === true,
        asksOwner: tool.asksOwner === true,
        run: async (context) => body(context, args),
      };
    },
  };
}

/** An owner message of a test, `msg_<n>`. */
export function ownerMessage(n: number, text: string, outside = false): OwnerMessage {
  return { id: `msg_${String(n)}`, text, outside };
}

/** What a test turn starts from. */
export interface TestTurnOptions {
  readonly replies: readonly ScriptedReply[];
  /** The turn's tools, or a function that makes them with the turn's recorder. */
  readonly tools?: readonly TestTool[] | ((recorder: TurnRecorder) => readonly TestTool[]);
  /** A tool box in place of the test tools. */
  readonly box?: ToolBox;
  readonly recorder?: TurnRecorderOptions;
  readonly taken?: readonly OwnerMessage[];
  readonly history?: readonly ModelMessage[];
  readonly outsideContent?: boolean;
  readonly limits?: Partial<TurnLimits>;
  /** The engine's side of the turn in place of the recorder's, such as a protocol client's. */
  readonly engine?: TurnEngine;
  /** The turn id the engine reserved; {@link testTurnId} when absent. */
  readonly turnId?: string;
  /** The turn's models in place of one model answering `replies`, made on the turn's clock. */
  readonly models?: (clock: ManualClock) => ModelChain;
  /** The one model answering `replies`: its name, `test/model` when absent, and its price. */
  readonly model?: { readonly name: string; readonly price?: ModelPrice };
  /** The turn's clock in place of a new one, such as one a chain's rests already use. */
  readonly clock?: ManualClock;
  /** The agent's live facts; a paper agent's, read at the turn's clock, when absent. */
  readonly facts?: LiveFactsReader;
  /** Reads the images of the taken messages; none can be read when absent. */
  readonly readImage?: ReadImage;
  /** The vision model, made on the turn's clock; none when absent. */
  readonly vision?: (clock: ManualClock) => ModelChain;
  /** The stable prefix; one line naming a test agent when absent. */
  readonly prefix?: string;
  /**
   * What the turn compacts with: the summary model's replies (`test/fast`), the context window,
   * and the stored history the turn loads, whose messages are the history when none is given.
   */
  readonly compaction?: {
    readonly summaries: readonly ScriptedReply[];
    readonly contextTokens: number;
    readonly stored: StoredHistory;
    readonly locale?: Locale;
  };
}

/** A test turn with its transport, recorder and clock. */
export interface TestTurn {
  readonly turn: ChatTurn;
  readonly transport: ScriptedTransport;
  /** The summary model's transport, which answers `compaction.summaries`. */
  readonly summarizer: ScriptedTransport;
  readonly recorder: TurnRecorder;
  readonly clock: ManualClock;
}

// The parts of a test turn: its models, its tools, and the recorder's journal, engine and queue.
function testParts(
  options: TestTurnOptions,
  made: {
    readonly transport: ScriptedTransport;
    readonly recorder: TurnRecorder;
    readonly clock: ManualClock;
  },
): TurnParts {
  const { transport, recorder, clock } = made;
  const tools = typeof options.tools === "function" ? options.tools(recorder) : options.tools;
  return {
    models:
      options.models?.(clock) ??
      (options.model === undefined
        ? oneModelChain(transport, clock)
        : createTestChain([{ ...options.model, transport }], { clock })),
    tools: options.box ?? testToolBox(tools ?? []),
    journal: recorder.journal,
    engine: options.engine ?? recorder.engine,
    merge: recorder.merge,
    // A paper agent's live facts, read at the turn's clock.
    facts:
      options.facts ??
      createRelayLiveFacts(createMemoryContextSource({ now: () => clock.now() }), testAgent),
    clock,
    ...imagePartsOf(options, clock),
  };
}

// How the turn reads the owner's images, and the vision model, when the test gives them.
function imagePartsOf(
  options: TestTurnOptions,
  clock: ManualClock,
): Pick<TurnParts, "readImage" | "vision"> {
  return {
    ...(options.readImage === undefined ? {} : { readImage: options.readImage }),
    ...(options.vision === undefined ? {} : { vision: options.vision(clock) }),
  };
}

// The turn's compaction on a summary model, `test/fast`, answering the test's summaries.
function testCompaction(
  options: TestTurnOptions,
  summarizer: ScriptedTransport,
  clock: ManualClock,
): Pick<ChatTurnOptions, "compaction"> {
  const { compaction } = options;
  if (compaction === undefined) {
    return {};
  }
  const fast = createTestChain([{ name: "test/fast", transport: summarizer }], { clock });
  const setup = {
    summarizer: fast,
    contextTokens: compaction.contextTokens,
    locale: compaction.locale ?? "en",
  };
  return { compaction: { setup, stored: compaction.stored } };
}

/** Creates a turn on a scripted model, a recorder and a manual clock. */
export function createTestTurn(options: TestTurnOptions): TestTurn {
  const transport = createScriptedTransport(options.replies);
  const recorder = createTurnRecorder(options.recorder);
  const clock = options.clock ?? createManualClock(1_000);
  const { compaction } = options;
  const summarizer = createScriptedTransport(compaction?.summaries ?? []);
  const loaded = compaction === undefined ? [] : messagesOf(compaction.stored);
  const turn = createChatTurn({
    turnId: options.turnId ?? testTurnId,
    parts: testParts(options, { transport, recorder, clock }),
    prefix: options.prefix ?? "You are a test agent.",
    history: options.history ?? loaded,
    ...testCompaction(options, summarizer, clock),
    taken: options.taken ?? [ownerMessage(1, "hello")],
    outsideContent: options.outsideContent ?? false,
    lifetime: new AbortController().signal,
    limits: { ...turnLimits, ...options.limits },
  });
  return { turn, transport, summarizer, recorder, clock };
}

/** A promise a test settles itself. */
export interface Gate<T> {
  readonly promise: Promise<T>;
  readonly open: (value: T) => void;
}

/** Creates a {@link Gate}. */
export function createGate<T>(): Gate<T> {
  const holder: { resolve?: (value: T) => void } = {};
  const promise = new Promise<T>((resolve) => {
    holder.resolve = resolve;
  });
  return { promise, open: (value) => holder.resolve?.(value) };
}
