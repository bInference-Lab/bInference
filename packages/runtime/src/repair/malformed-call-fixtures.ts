// Malformed tool calls for the repair's tests (decision 0447). Each one is constructed by hand to
// a shape the decision names, not recorded from a model server: a recorded session replaces them
// once one exists. Each names its shape and the agent's tool it calls.

import type { JsonValue } from "@binference/core";
import type { RepairStep } from "./repair-step.js";

/** What a repair makes of a fixture's call. */
export type FixtureOutcome =
  /** The call as binference reads it, which the tool box takes. */
  | { readonly repaired: readonly RepairStep[]; readonly reads: JsonValue }
  /** No repair: a step cannot read it without a guess, or it needs none. */
  | "none"
  /** A repair reads it, and the tool box refuses what it read. */
  | "refused";

/** One malformed call, constructed to a shape of decision 0447. */
export interface MalformedCallFixture {
  readonly shape: string;
  readonly name: string;
  readonly arguments: string;
  readonly outcome: FixtureOutcome;
}

const coin = "fake:1/slip44:1";
const token = "fake:1/token:0x0000000a";
const swap = `"from":"${coin}","to":"${token}","amount":{"base":"100000000000000000"}`;
const swapRead = {
  from: coin,
  to: token,
  amount: { base: "100000000000000000" },
  reason: "Asked.",
};
const search = { query: "cake" };

/** The repairable shapes: each is repaired, and the tool box takes what the repair read. */
export const repairableFixtures: readonly MalformedCallFixture[] = [
  {
    shape: "fence with a language",
    name: "swap",
    arguments: `\`\`\`json\n{${swap},"reason":"Asked."}\n\`\`\``,
    outcome: { repaired: ["fence"], reads: swapRead },
  },
  {
    shape: "fence without a language",
    name: "notes_search",
    arguments: '```\n{"query":"cake"}\n```',
    outcome: { repaired: ["fence"], reads: search },
  },
  {
    shape: "a label before the object",
    name: "notes_search",
    arguments: 'Arguments: {"query":"cake"}',
    outcome: { repaired: ["words_around"], reads: search },
  },
  {
    shape: "call tags around the object",
    name: "notes_search",
    arguments: '<tool_call> {"query":"cake"} </tool_call>',
    outcome: { repaired: ["words_around"], reads: search },
  },
  {
    shape: "the object written as a JSON string",
    name: "swap",
    arguments: JSON.stringify(`{${swap},"reason":"Asked."}`),
    outcome: { repaired: ["string_object"], reads: swapRead },
  },
  {
    shape: "single quotes",
    name: "notes_search",
    arguments: "{'query': 'cake'}",
    outcome: { repaired: ["single_quotes"], reads: search },
  },
  {
    shape: "single quotes with an escaped apostrophe and a double quote",
    name: "notes_write",
    arguments: String.raw`{'text': 'the owner\'s "plan"'}`,
    outcome: { repaired: ["single_quotes"], reads: { text: 'the owner\'s "plan"' } },
  },
  {
    shape: "a trailing comma in an object",
    name: "swap",
    arguments: `{${swap},"reason":"Asked.",}`,
    outcome: { repaired: ["trailing_comma"], reads: swapRead },
  },
  {
    shape: "a trailing comma in a list",
    name: "send_files",
    arguments: '{"caption":"Two.","paths":["a.csv","b.csv",]}',
    outcome: {
      repaired: ["trailing_comma"],
      reads: { caption: "Two.", paths: ["a.csv", "b.csv"] },
    },
  },
  {
    shape: "the last brace missing after a string",
    name: "notes_search",
    arguments: '{"query":"cake"',
    outcome: { repaired: ["closed"], reads: search },
  },
  {
    shape: "a list and an object left open after a string",
    name: "send_files",
    arguments: '{"caption":"One.","paths":["a.csv"',
    outcome: { repaired: ["closed"], reads: { caption: "One.", paths: ["a.csv"] } },
  },
  {
    shape: "the last brace missing after a closed object",
    name: "swap",
    arguments: `{"reason":"Asked.",${swap}`,
    outcome: { repaired: ["closed"], reads: swapRead },
  },
  {
    shape: "a name in capitals",
    name: "Notes_Search",
    arguments: '{"query":"cake"}',
    outcome: { repaired: ["name_case"], reads: search },
  },
  {
    shape: "a name behind functions.",
    name: "functions.notes_search",
    arguments: '{"query":"cake"}',
    outcome: { repaired: ["name_prefix"], reads: search },
  },
  {
    shape: "a name behind default_api:",
    name: "default_api:swap",
    arguments: `{${swap},"reason":"Asked."}`,
    outcome: { repaired: ["name_prefix"], reads: swapRead },
  },
  {
    shape: "a name behind a prefix and in capitals",
    name: "Tools/SWAP",
    arguments: `{${swap},"reason":"Asked."}`,
    outcome: { repaired: ["name_prefix", "name_case"], reads: swapRead },
  },
  {
    shape: "an integer as a string on a read",
    name: "file_read",
    arguments: '{"path":"a.txt","offset":"3","limit":"20"}',
    outcome: { repaired: ["integer_string"], reads: { path: "a.txt", offset: 3, limit: 20 } },
  },
  {
    shape: "null for an optional field of a read",
    name: "notes_search",
    arguments: '{"query":"cake","limit":null}',
    outcome: { repaired: ["null_optional"], reads: search },
  },
  {
    shape: "words around a command, which the turn holds as it holds a proposal",
    name: "shell",
    arguments: 'Do not run this example: {"command":"git push --force"}',
    outcome: { repaired: ["words_around"], reads: { command: "git push --force" } },
  },
  {
    shape: "a fence, single quotes and a trailing comma together",
    name: "swap",
    arguments: `\`\`\`\n{'from': '${coin}', 'to': '${token}', 'amount': {'base': '100000000000000000'}, 'reason': 'Asked.',}\n\`\`\``,
    outcome: { repaired: ["fence", "single_quotes", "trailing_comma"], reads: swapRead },
  },
  {
    shape: "an amount past 2^53 in plain digits, kept digit for digit",
    name: "swap",
    arguments: `\`\`\`\n{"from":"${coin}","to":"${token}","amount":{"base":100000000000000001},"reason":"Asked."}\n\`\`\``,
    outcome: {
      repaired: ["fence"],
      reads: { ...swapRead, amount: { base: "100000000000000001" } },
    },
  },
];

/** The shapes never repaired: each answers no repair, or a repair the tool box refuses. */
export const neverRepairedFixtures: readonly MalformedCallFixture[] = [
  {
    shape: "an apostrophe inside a single-quoted value",
    name: "notes_write",
    arguments: "{'text': 'it's done'}",
    outcome: "none",
  },
  {
    shape: "a single-quoted value with an escape JSON lacks",
    name: "notes_search",
    arguments: String.raw`{'query': 'ca\qke'}`,
    outcome: "none",
  },
  {
    shape: "cut inside a string",
    name: "swap",
    arguments: `{"from":"${coin}","to":"fake:1/tok`,
    outcome: "none",
  },
  {
    shape: "cut after a comma",
    name: "notes_search",
    arguments: '{"query":"cake",',
    outcome: "none",
  },
  { shape: "cut after a key", name: "notes_search", arguments: '{"query"', outcome: "none" },
  { shape: "cut after a colon", name: "notes_search", arguments: '{"query":', outcome: "none" },
  {
    shape: "cut after a number",
    name: "file_read",
    arguments: '{"path":"a.txt","limit":2',
    outcome: "none",
  },
  {
    shape: "a number in a money field of a proposal",
    name: "swap",
    arguments: `{"from":"${coin}","to":"${token}","amount":{"base":100},"reason":"Asked."}`,
    outcome: "none",
  },
  {
    shape: "a number in a money field of a read",
    name: "quote",
    arguments: `{"from":"${coin}","to":"${token}","amount":{"base":100},"reason":"Asked."}`,
    outcome: "none",
  },
  {
    shape: "an integer as a string on a machine call",
    name: "shell",
    arguments: '{"command":"ls -la","timeoutSeconds":"30"}',
    outcome: "none",
  },
  {
    shape: "a fence label with digits on the object's line",
    name: "notes_search",
    arguments: '```0x5c95 {"query":"cake"}```',
    outcome: "none",
  },
  {
    shape: "an integer as a string on a proposal",
    name: "swap",
    arguments: `{${swap},"maxSlippageBps":"50","reason":"Asked."}`,
    outcome: "none",
  },
  {
    shape: "null for an optional field of a proposal",
    name: "swap",
    arguments: `{${swap},"maxSlippageBps":null,"reason":"Asked."}`,
    outcome: "none",
  },
  {
    shape: "two objects",
    name: "notes_search",
    arguments: '{"query":"a"} {"query":"b"}',
    outcome: "none",
  },
  {
    shape: "a digit in the words around",
    name: "notes_search",
    arguments: 'Use 2 of these: {"query":"cake"}',
    outcome: "none",
  },
  {
    shape: "a quote in the words around",
    name: "notes_search",
    arguments: 'the "args": {"query":"cake"}',
    outcome: "none",
  },
  {
    shape: "a call marker of a model format around",
    name: "notes_search",
    arguments: '<|call|>{"query":"cake"}',
    outcome: "none",
  },
  { shape: "a name that fits no tool", name: "swapp", arguments: "{}", outcome: "none" },
  {
    shape: "a field the schema does not name",
    name: "notes_search",
    arguments: '{"query":"cake","wallet":"wal_1"}',
    outcome: "none",
  },
  {
    shape: "a required field left out",
    name: "swap",
    arguments: `{"from":"${coin}","to":"${token}","reason":"Asked."}`,
    outcome: "none",
  },
  {
    shape: "a key written twice",
    name: "notes_search",
    arguments: '{"query":"a","query":"b",}',
    outcome: "none",
  },
  {
    shape: "an integer past 2^53 not written as plain digits",
    name: "swap",
    arguments: `\`\`\`\n{"from":"${coin}","to":"${token}","amount":{"base":1e21},"reason":"Asked."}\n\`\`\``,
    outcome: "refused",
  },
  {
    shape: "a call written as text, with no object",
    name: "notes_search",
    arguments: "notes_search query=cake",
    outcome: "none",
  },
];
