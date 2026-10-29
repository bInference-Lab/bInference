import { type JsonValue, jsonValueSchema } from "@binference/core";
import {
  type Locale,
  type ProtocolErrorCode,
  protocolErrorCodes,
  type WorkspaceFile,
  workspaceFiles,
} from "@binference/protocol";
import { z } from "zod";

// A model evaluation scenario (ARCHITECTURE.md section 19; decision 0291): what the owner says,
// what the engine, the venue, the web and the images answer, and what the scorer checks.

/** Which bar a scenario counts toward: safety (100%) or understanding (90%), in each language. */
export type ScenarioTag = "safety" | "understanding";

/** What a scenario tests, one item of the evaluation's list. */
export type ScenarioTopic =
  | "plain_words"
  | "unasked_send"
  | "planted_instruction"
  | "invented_address"
  | "truthful_failure"
  | "no_tool_fits"
  | "one_at_a_time"
  | "token_risk";

/** A check of the scorer; each miss of one names it. */
export type CheckName =
  | "proposals"
  | "controls"
  | "mentions"
  | "never"
  | "no_send"
  | "no_invented_address"
  | "no_outside_address";

/** One call a stand-in model makes: a tool and its arguments. */
interface StandInCall {
  readonly name: string;
  readonly args: JsonValue;
}

/** One response of a stand-in model: its text, its tool calls, or both. */
export interface StandInReply {
  readonly text?: string;
  readonly calls?: readonly StandInCall[];
}

/** A terminal state the engine settles the agent's last proposal in. */
export type SettledState =
  | "paper_filled"
  | "reconciled"
  | "failed_onchain"
  | "denied"
  | "expired"
  | "rejected_policy"
  | "risk_blocked";

/** One step of a scenario: the owner writes, or the agent's last proposal settles. */
export type ScenarioStep =
  | { readonly owner: string; readonly images?: readonly string[] }
  | { readonly settle: SettledState; readonly reason?: string };

/** A risk check as the engine answers it for a token. */
export interface WorldRisk {
  readonly verdict: "pass" | "warn" | "block";
  readonly flags: readonly { readonly code: string; readonly source: string }[];
  readonly buyTaxBps?: number;
  readonly sellTaxBps?: number;
  readonly liquidityUsdMicros?: string;
  /** Why the engine refuses to buy the token, when its verdict blocks it, such as `high_tax`. */
  readonly refusal?: string;
}

/** A token of the scenario's world, named by its key in the scenario as `@KEY`. */
export interface WorldToken {
  readonly key: string;
  readonly asset: string;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  /** binference's token list holds it. */
  readonly verified: boolean;
  /** Micro-dollars per whole token. */
  readonly priceUsdMicros: string;
  readonly risk?: WorldRisk;
}

/** What the agent's wallet holds of a token, in base units. */
export interface WorldBalance {
  readonly token: string;
  readonly base: string;
}

/** An engine refusal: its error code and message. */
export interface EngineRefusal {
  readonly code: ProtocolErrorCode;
  readonly message: string;
}

/** How the engine answers a proposal its checks refuse: the intent's state and reason. */
export interface RefusedProposal {
  readonly state: "rejected_policy" | "risk_blocked" | "failed_check";
  readonly reason: string;
}

/** One search result the web search answers. */
interface SearchResult {
  readonly title: string;
  readonly url: string;
  readonly description: string;
}

/** Everything outside the model that a scenario's turns read, on top of the shared world. */
export interface ScenarioWorld {
  readonly tokens?: readonly WorldToken[];
  /** In place of the shared world's balances. */
  readonly balances?: readonly WorldBalance[];
  /** The keys of the tokens a trending scan answers, in its order. */
  readonly trending?: readonly string[];
  /** An operation's result, as JSON carries it, in place of the computed one. */
  readonly answers?: Readonly<Record<string, JsonValue>>;
  /** An operation the engine refuses, with the refusal. */
  readonly refusals?: Readonly<Record<string, EngineRefusal>>;
  /** A proposal the engine's checks refuse; a proposal waits for the owner when absent. */
  readonly refusedProposal?: RefusedProposal;
  /** Each page `read_page` reaches, its HTML by its URL. */
  readonly pages?: Readonly<Record<string, string>>;
  readonly search?: readonly SearchResult[];
  /** What the vision model says each of the owner's images shows, by the image's name. */
  readonly images?: Readonly<Record<string, string>>;
  readonly workspace?: Readonly<Partial<Record<WorkspaceFile, string>>>;
}

/** A tool call a scenario expects: the tool and the arguments it must hold, at least. */
export interface ExpectedCall {
  readonly tool: string;
  readonly args?: JsonValue;
}

/** One expected call, or one of several that are each right. */
export type CallExpectation = ExpectedCall | { readonly anyOf: readonly ExpectedCall[] };

/** What the scorer checks of a scenario's run, besides the checks every run gets. */
export interface ScenarioExpect {
  /** The proposals that reach the engine, in order; none when empty. */
  readonly proposals: readonly CallExpectation[];
  /** The proposals may reach the engine in any order, as when the owner asked for two at once. */
  readonly anyOrder?: boolean;
  /** Control calls that must run, such as `alert_create`, in any order. */
  readonly controls?: readonly CallExpectation[];
  /** Each group names words of which the agent's replies hold at least one. */
  readonly mentions?: readonly (readonly string[])[];
  /** Words the agent's replies never hold, such as a claim the trade filled. */
  readonly never?: readonly string[];
}

/** A wrong scripted answer to a scenario, and the checks it must miss. */
interface WrongAnswer {
  readonly misses: readonly CheckName[];
  readonly replies: readonly StandInReply[];
}

/**
 * The scripted answers that prove a scenario: the right one passes, and each wrong one misses
 * the checks it names. Together the wrong ones miss every check the scenario declares.
 */
interface ScenarioProof {
  readonly right: readonly StandInReply[];
  readonly wrong: readonly WrongAnswer[];
}

/** A token whose risk check comes from a BNB Smart Chain fork when the run asks for one. */
interface ForkCase {
  readonly token: string;
}

/** One scenario of the model evaluation, in one language. */
export interface Scenario {
  /** The same id in each language. */
  readonly id: string;
  readonly locale: Locale;
  readonly tag: ScenarioTag;
  readonly topic: ScenarioTopic;
  /** The bundled skill whose playbook the scenario tests, by its name. */
  readonly skill?: string;
  readonly fork?: ForkCase;
  readonly steps: readonly ScenarioStep[];
  readonly world: ScenarioWorld;
  readonly expect: ScenarioExpect;
  readonly proof: ScenarioProof;
}

const word = z.string().min(1);
const base = z.string().regex(/^\d+$/);
const checkNameList = [
  "proposals",
  "controls",
  "mentions",
  "never",
  "no_send",
  "no_invented_address",
  "no_outside_address",
] as const;

const replySchema: z.ZodType<StandInReply> = z.strictObject({
  text: word.exactOptional(),
  calls: z.array(z.strictObject({ name: word, args: jsonValueSchema })).exactOptional(),
});

const stepSchema: z.ZodType<ScenarioStep> = z.union([
  z.strictObject({ owner: word, images: z.array(word).exactOptional() }),
  z.strictObject({
    settle: z.enum([
      "paper_filled",
      "reconciled",
      "failed_onchain",
      "denied",
      "expired",
      "rejected_policy",
      "risk_blocked",
    ]),
    reason: word.exactOptional(),
  }),
]);

const riskSchema: z.ZodType<WorldRisk> = z.strictObject({
  verdict: z.enum(["pass", "warn", "block"]),
  flags: z.array(z.strictObject({ code: word, source: word })),
  buyTaxBps: z.int().min(0).max(10_000).exactOptional(),
  sellTaxBps: z.int().min(0).max(10_000).exactOptional(),
  liquidityUsdMicros: base.exactOptional(),
  refusal: z
    .string()
    .regex(/^[a-z][a-z_]*$/)
    .exactOptional(),
});

/** Parses a token of a scenario's world. */
const worldTokenSchema: z.ZodType<WorldToken> = z.strictObject({
  key: z.string().regex(/^[A-Z][A-Z0-9]*$/),
  asset: word,
  symbol: word,
  name: word,
  decimals: z.int().min(0).max(36),
  verified: z.boolean(),
  priceUsdMicros: base,
  risk: riskSchema.exactOptional(),
});

/** Parses what a scenario's world adds to or replaces in the shared world. */
export const scenarioWorldSchema: z.ZodType<ScenarioWorld> = z.strictObject({
  tokens: z.array(worldTokenSchema).exactOptional(),
  balances: z.array(z.strictObject({ token: word, base })).exactOptional(),
  trending: z.array(word).exactOptional(),
  answers: z.record(word, jsonValueSchema).exactOptional(),
  refusals: z
    .record(word, z.strictObject({ code: z.enum(protocolErrorCodes), message: word }))
    .exactOptional(),
  refusedProposal: z
    .strictObject({
      state: z.enum(["rejected_policy", "risk_blocked", "failed_check"]),
      reason: z.string().regex(/^[a-z][a-z_]*$/),
    })
    .exactOptional(),
  pages: z.record(z.url(), word).exactOptional(),
  search: z.array(z.strictObject({ title: word, url: z.url(), description: word })).exactOptional(),
  images: z.record(word, word).exactOptional(),
  workspace: z.partialRecord(z.enum(workspaceFiles), word).exactOptional(),
});

const expectedCallSchema: z.ZodType<ExpectedCall> = z.strictObject({
  tool: word,
  args: jsonValueSchema.exactOptional(),
});

const expectationSchema: z.ZodType<CallExpectation> = z.union([
  expectedCallSchema,
  z.strictObject({ anyOf: z.array(expectedCallSchema).min(2) }),
]);

/** Parses one scenario file, with its language from the folder it sits in. */
export const scenarioSchema: z.ZodType<Scenario> = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  locale: z.enum(["en", "zh"]),
  tag: z.enum(["safety", "understanding"]),
  topic: z.enum([
    "plain_words",
    "unasked_send",
    "planted_instruction",
    "invented_address",
    "truthful_failure",
    "no_tool_fits",
    "one_at_a_time",
    "token_risk",
  ]),
  skill: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .exactOptional(),
  fork: z.strictObject({ token: word }).exactOptional(),
  steps: z.array(stepSchema).min(1),
  world: scenarioWorldSchema,
  expect: z.strictObject({
    proposals: z.array(expectationSchema),
    anyOrder: z.boolean().exactOptional(),
    controls: z.array(expectationSchema).exactOptional(),
    mentions: z.array(z.array(word).min(1)).exactOptional(),
    never: z.array(word).exactOptional(),
  }),
  proof: z.strictObject({
    right: z.array(replySchema).min(1),
    wrong: z
      .array(
        z.strictObject({
          misses: z.array(z.enum(checkNameList)).min(1),
          replies: z.array(replySchema).min(1),
        }),
      )
      .min(1),
  }),
});
