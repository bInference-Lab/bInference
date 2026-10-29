import type { CallableName } from "@binference/client";
import { BinferenceError, type Id, type JsonValue, jsonValueSchema } from "@binference/core";
import { type IntentView, type OperationShapes, operations } from "@binference/protocol";
import type { ToolClient } from "@binference/runtime/testing";
import type {
  EngineRefusal,
  RefusedProposal,
  ScenarioWorld,
  SettledState,
} from "./scenario.schema.js";
import {
  amountInOf,
  assetInfosOf,
  assetViewOf,
  objectOf,
  portfolioOf,
  quoteOf,
  riskOf,
  searchOf,
  tokenOf,
  type WireObject,
  type WorldFacts,
} from "./world-answers.js";

/** An operation the agent's tools call. */
type ToolOperation = CallableName<OperationShapes>;

/** One operation the agent's tools called: its name and its args as JSON carries them. */
export interface EngineCall {
  readonly op: ToolOperation;
  readonly args: WireObject;
}

/**
 * The engine and the venue of one scenario's run: the operations the agent's tools call, each
 * answered from the scenario's world, and what they asked.
 */
export interface ScenarioEngine {
  readonly client: ToolClient;
  /** Every call, oldest first. */
  calls(): readonly EngineCall[];
  /** The intent of the last proposal, settled in `state`; none before a proposal. */
  settled(state: SettledState, reason?: string): IntentView | undefined;
}

/** What a scenario's engine answers from. */
export interface ScenarioEngineParts {
  readonly facts: WorldFacts;
  readonly world: ScenarioWorld;
  readonly agent: Id<"agt">;
}

type Answer = (args: WireObject, parts: ScenarioEngineParts, ids: () => string) => JsonValue;

const empty: Answer = () => ({ items: [] });

function field(args: WireObject, name: string): JsonValue | undefined {
  return args[name];
}

function textField(args: WireObject, name: string): string {
  const value = args[name];
  return typeof value === "string" ? value : "";
}

// The engine's risk check refuses a buy of a token its check blocks, before any card.
function riskRefusal(args: WireObject, facts: WorldFacts): RefusedProposal | undefined {
  const bought = field(args, "kind") === "swap" ? field(args, "to") : field(args, "token");
  const kind = field(args, "kind");
  if (bought === undefined || kind === "sell") {
    return undefined;
  }
  const risk = tokenOf(facts, bought).risk;
  return risk?.verdict === "block"
    ? { state: "risk_blocked", reason: risk.refusal ?? risk.flags[0]?.code ?? "blocked" }
    : undefined;
}

// A bundled skill's `SKILL.md`, as the engine's `skill/read` answers it; the evaluation reads no
// other file of a skill.
function skillTextOf(args: WireObject, facts: WorldFacts): JsonValue {
  const file = field(args, "file") ?? "SKILL.md";
  const skill = facts.skills.find(({ name }) => name === field(args, "skill"));
  if (skill === undefined || file !== "SKILL.md") {
    throw new BinferenceError({
      code: "skill.not_found",
      message: "No skill in this agent's index holds that file.",
    });
  }
  const { name, location, text } = skill;
  return { skill: name, place: "bundled", location, file, text };
}

function intentOf(
  args: WireObject,
  parts: ScenarioEngineParts,
  shown: { readonly id: string; readonly refused?: RefusedProposal },
): WireObject {
  const named = ["from", "to", "token", "receive"].map((name) => field(args, name));
  const assets = [...named, objectOf(field(args, "spend"))["asset"]].filter(
    (asset) => asset !== undefined,
  );
  const tokens = assets.map((asset) => tokenOf(parts.facts, asset));
  const refused = shown.refused ?? riskRefusal(args, parts.facts);
  return {
    intent: `int_${shown.id}`,
    agent: parts.agent,
    wallet: parts.facts.wallet,
    kind: textField(args, "kind"),
    state: refused?.state ?? "awaiting_confirmation",
    request: args,
    ...(refused === undefined ? {} : { outcome: { reason: refused.reason } }),
    paper: true,
    outsideContent: false,
    createdAt: parts.facts.now,
    changedAt: parts.facts.now,
    assets: assetInfosOf(tokens),
  };
}

const answers: Partial<Readonly<Record<ToolOperation, Answer>>> = {
  "asset/search": (args, { facts }) => searchOf(facts, textField(args, "query")),
  "asset/get": (args, { facts }) => assetViewOf(tokenOf(facts, field(args, "asset")), facts.now),
  "risk/check": (args, { facts }) => riskOf(tokenOf(facts, field(args, "asset")), facts.now),
  "portfolio/get": (_args, { facts }) => portfolioOf(facts),
  "quote/get": (args, { facts }) => {
    const from = tokenOf(facts, field(args, "from"));
    const to = tokenOf(facts, field(args, "to"));
    return quoteOf(facts, { from, to, base: amountInOf(facts, from.asset, field(args, "amount")) });
  },
  "intent/propose": (args, parts, ids) => {
    const refused = parts.world.refusedProposal;
    return intentOf(args, parts, { id: ids(), ...(refused === undefined ? {} : { refused }) });
  },
  "order/create": (args, { facts, agent }, ids) => ({
    order: `ord_${ids()}`,
    agent,
    wallet: facts.wallet,
    kind: textField(args, "kind"),
    state: "awaiting_confirmation",
    request: { ...args, wallet: facts.wallet },
    fills: 0,
    expiresAt: facts.now + 2_592_000_000,
    paper: true,
    createdAt: facts.now,
    changedAt: facts.now,
  }),
  "alert/create": (args, { facts, agent }, ids) => ({
    alert: `alr_${ids()}`,
    agent,
    condition: field(args, "condition") ?? null,
    state: "active",
    createdAt: facts.now,
  }),
  "market/scan": (_args, { facts, world }) => ({
    items: (world.trending ?? []).map((key) => {
      const token = facts.tokens.find((item) => item.key === key);
      return token === undefined
        ? {}
        : { asset: token.asset, priceUsdMicros: token.priceUsdMicros };
    }),
    assets: assetInfosOf(facts.tokens.filter((token) => world.trending?.includes(token.key))),
  }),
  "skill/read": (args, { facts }) => skillTextOf(args, facts),
  "order/list": empty,
  "notes/search": empty,
  "schedule/list": empty,
};

function refusalOf(refusal: EngineRefusal): BinferenceError {
  return new BinferenceError({ code: refusal.code, message: refusal.message });
}

function answerOf(
  op: ToolOperation,
  args: WireObject,
  context: { readonly parts: ScenarioEngineParts; readonly ids: () => string },
): JsonValue {
  const { world } = context.parts;
  const refusal = world.refusals?.[op];
  if (refusal !== undefined) {
    throw refusalOf(refusal);
  }
  const given = world.answers?.[op];
  const computed = answers[op];
  if (given !== undefined) {
    return given;
  }
  if (computed === undefined) {
    throw new BinferenceError({
      code: "protocol.unknown_op",
      message: `This evaluation's engine answers no ${op}.`,
    });
  }
  return computed(args, context.parts, context.ids);
}

/** Creates the engine of one scenario's run on its world's facts. */
export function createScenarioEngine(parts: ScenarioEngineParts): ScenarioEngine {
  const taken: EngineCall[] = [];
  const proposed: { last?: JsonValue } = {};
  let count = 0;
  const ids = (): string => {
    count += 1;
    return `0190f1c2-3a4b-7c5d-8e6f-${count.toString(16).padStart(12, "0")}`;
  };
  return {
    calls: () => [...taken],
    client: {
      async call(op, args) {
        const operation = operations[op];
        const wire = objectOf(jsonValueSchema.parse(operation.args.encode(args)));
        taken.push({ op, args: wire });
        const answer = await Promise.resolve(answerOf(op, wire, { parts, ids }));
        if (op === "intent/propose") {
          proposed.last = answer;
        }
        return operation.result.parse(answer);
      },
    },
    settled(state, reason) {
      const { last } = proposed;
      if (last === undefined) {
        return undefined;
      }
      const outcome = reason === undefined ? {} : { outcome: { reason } };
      return operations["intent/get"].result.parse({ ...objectOf(last), state, ...outcome });
    },
  };
}
