import { BinferenceError, idSchema } from "@binference/core";
import type { ToolKind } from "../loop/turn-records.js";
import { agentTools } from "./agent-tools.js";
import type { AgentToolParts } from "./tool-client.js";

/** One of the agent's tools as the model sees it: its name, kind and description. */
export interface ToolReference {
  readonly name: string;
  readonly kind: ToolKind;
  /** What the model reads to decide when to call it; English, as every tool text. */
  readonly description: string;
}

function neverCalled(): never {
  throw new BinferenceError({
    code: "runtime.tool_invalid",
    message: "A tool of the reference was called; the reference only reads declarations.",
  });
}

// Parts that only declare the tools: no call reaches the engine, the web, a model or a helper. The
// X key, the image, video and speech parts, the helper, goal and status parts are set so the
// reference lists search_x, make_image, make_video, speak, the helper and goal tools and
// agent_status with its model, which the agent has whenever the owner set them or its own turn runs.
const declaringParts: AgentToolParts = {
  agent: idSchema("agt").parse("agt_00000000-0000-7000-8000-000000000000"),
  client: { call: neverCalled },
  turn: {
    session: idSchema("ses").parse("ses_00000000-0000-7000-8000-000000000000"),
    turn: idSchema("trn").parse("trn_00000000-0000-7000-8000-000000000000"),
  },
  web: {
    http: { open: neverCalled },
    lookup: neverCalled,
    clock: { now: neverCalled, sleep: neverCalled },
    search: { keys: {}, xApiKey: "declared" },
  },
  imageMaking: {
    jobs: { running: neverCalled, start: neverCalled },
    maker: "declared",
    random: { bytes: neverCalled },
    clock: { now: neverCalled, sleep: neverCalled },
  },
  videoMaking: {
    jobs: { running: neverCalled, start: neverCalled },
    maker: "declared",
    random: { bytes: neverCalled },
    clock: { now: neverCalled, sleep: neverCalled },
  },
  speaking: {
    source: { kind: "none", failure: "declared" },
    random: { bytes: neverCalled },
  },
  helpers: {
    desk: {
      start: neverCalled,
      list: neverCalled,
      read: neverCalled,
      send: neverCalled,
      stop: neverCalled,
    },
    clock: { now: neverCalled, sleep: neverCalled },
  },
  goals: {
    desk: {
      read: neverCalled,
      active: neverCalled,
      set: neverCalled,
      move: neverCalled,
      write: neverCalled,
      pause: neverCalled,
      clear: neverCalled,
      forget: neverCalled,
      request: neverCalled,
      putNote: neverCalled,
    },
  },
  status: {
    chats: { read: neverCalled, setModel: neverCalled, budgetLeft: neverCalled },
    settings: {
      models: {
        providers: {},
        imageInput: [],
        fallbacks: { main: [], fast: [] },
        idleTimeoutMs: 1,
        cooldownMs: 1,
        maxToolCallsPerTurn: 1,
        loopDetection: true,
        prices: {},
      },
      owner: { locale: "en", timezone: "UTC" },
    },
    version: "declared",
    clock: { now: neverCalled, sleep: neverCalled },
  },
};

/**
 * Every tool the agent's model may call, in the order a turn offers them, with its web tools and
 * without any community plugin's: the docs site's tool reference is generated from it.
 */
export function describeAgentTools(): readonly ToolReference[] {
  return agentTools(declaringParts).map((tool) => ({
    name: tool.name,
    kind: tool.kind,
    description: tool.declaration.description,
  }));
}
