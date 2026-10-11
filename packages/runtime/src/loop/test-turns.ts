import { type JsonValue, jsonValueSchema } from "@binference/core";
import { createManualClock, type ManualClock } from "@binference/core/testing";
import {
  createScriptedTransport,
  type ScriptedReply,
  type ScriptedTransport,
} from "../testing/scripted-transport.js";
import {
  createTurnRecorder,
  type TurnRecorder,
  type TurnRecorderOptions,
} from "../testing/turn-recorder.js";
import { type ChatTurn, createChatTurn } from "./chat-turn.js";
import type { ModelMessage, OwnerMessage } from "./model-message.js";
import type { ToolBox, ToolKind, ToolOutcome, ToolRunContext, TurnEngine } from "./turn-ports.js";
import { type TurnLimits, turnLimits } from "./turn-run.js";

/** The turn id every test turn runs under. */
export const testTurnId = "trn_0190f1c2-3a4b-7c5d-8e6f-000000000001";

/** A tool of a test's tool box; it answers `ran <name>` unless it runs its own body. */
export interface TestTool {
  readonly name: string;
  readonly kind: ToolKind;
  readonly parallel?: boolean;
  readonly outside?: boolean;
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
}

/** A test turn with its transport, recorder and clock. */
export interface TestTurn {
  readonly turn: ChatTurn;
  readonly transport: ScriptedTransport;
  readonly recorder: TurnRecorder;
  readonly clock: ManualClock;
}

/** Creates a turn on a scripted model, a recorder and a manual clock. */
export function createTestTurn(options: TestTurnOptions): TestTurn {
  const transport = createScriptedTransport(options.replies);
  const recorder = createTurnRecorder(options.recorder);
  const clock = createManualClock(1_000);
  const tools = typeof options.tools === "function" ? options.tools(recorder) : options.tools;
  const turn = createChatTurn({
    turnId: options.turnId ?? testTurnId,
    parts: {
      transport,
      tools: options.box ?? testToolBox(tools ?? []),
      journal: recorder.journal,
      engine: options.engine ?? recorder.engine,
      merge: recorder.merge,
      clock,
    },
    instructions: "You are a test agent.",
    history: options.history ?? [],
    taken: options.taken ?? [ownerMessage(1, "hello")],
    outsideContent: options.outsideContent ?? false,
    lifetime: new AbortController().signal,
    limits: { ...turnLimits, ...options.limits },
  });
  return { turn, transport, recorder, clock };
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
