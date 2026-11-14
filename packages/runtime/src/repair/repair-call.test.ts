import type { JsonValue } from "@binference/core";
import { describe, expect, it } from "vitest";
import { agent, toolTurn } from "../testing/agent-tool-fixtures.js";
import { createFakeToolClient } from "../testing/fake-tool-client.js";
import { agentToolBox, agentTools } from "../tools/agent-tools.js";
import { maxArgumentsChars, parseArgumentsJson } from "../tools/arguments-json.schema.js";
import {
  type FixtureOutcome,
  type MalformedCallFixture,
  neverRepairedFixtures,
  repairableFixtures,
} from "./malformed-call-fixtures.js";
import { repairCall, type RepairTools } from "./repair-call.js";

const parts = { agent, client: createFakeToolClient({}), turn: toolTurn };
const box = agentToolBox(parts);
const kinds = new Map(agentTools(parts).map((tool) => [tool.name, tool.kind]));
const tools: RepairTools = { declarations: box.declarations, kindOf: (name) => kinds.get(name) };

// Arguments with a trailing comma that hold `count` lone halves of a surrogate pair: one
// character each as written, and six each once written as JSON.
const loneHalves = (count: number): string => `{"query":"${"\uD800".repeat(count)}",}`;

function callOf(fixture: MalformedCallFixture): {
  readonly id: string;
  readonly name: string;
  readonly argumentsText: string;
} {
  return { id: "call_1", name: fixture.name, argumentsText: fixture.arguments };
}

function readingOf(text: string): JsonValue | undefined {
  const read = parseArgumentsJson(text);
  return read.ok ? read.value : undefined;
}

// What the repair and then the tool box make of the call: the steps and what the tool box reads,
// or no repair, or a repair the tool box refuses.
function outcomeOf(fixture: MalformedCallFixture): FixtureOutcome | { readonly reads: undefined } {
  const repaired = repairCall(callOf(fixture), tools);
  if (repaired === undefined) {
    return "none";
  }
  const call = { id: "call_1", name: repaired.name, argumentsText: repaired.argumentsText };
  return box.prepare(call).ready
    ? { repaired: repaired.steps, reads: readingOf(repaired.argumentsText) ?? null }
    : "refused";
}

describe("repairCall on calls constructed to the shapes of decision 0447", () => {
  it.each(repairableFixtures)("repairs $shape", (fixture) => {
    expect(box.prepare(callOf(fixture)).ready).toBe(false);
    expect(outcomeOf(fixture)).toStrictEqual(fixture.outcome);
  });

  it.each(neverRepairedFixtures)("never repairs $shape", (fixture) => {
    expect(box.prepare(callOf(fixture)).ready).toBe(false);
    expect(outcomeOf(fixture)).toStrictEqual(fixture.outcome);
  });
});

describe("repairCall", () => {
  it("writes the arguments it read as one line of json, each number as the model wrote it", () => {
    const written = '```\n{\n  "path": "a.txt",\n  "offset": 1.50e0\n}\n```';
    const repaired = repairCall({ id: "c", name: "file_read", argumentsText: written }, tools);
    expect(repaired?.argumentsText).toBe('{"path":"a.txt","offset":1.50e0}');
  });

  it("repairs a name alone when the arguments are empty", () => {
    const repaired = repairCall({ id: "c", name: "PORTFOLIO", argumentsText: "" }, tools);
    expect(repaired).toStrictEqual({
      name: "portfolio",
      argumentsText: "{}",
      steps: ["name_case"],
    });
  });

  it("answers no repair for a call that needs none", () => {
    const call = { id: "c", name: "notes_search", argumentsText: '{"query":"cake"}' };
    expect(repairCall(call, tools)).toBeUndefined();
  });

  it("leaves the values of a tool whose kind it cannot read as written", () => {
    const blind: RepairTools = { declarations: box.declarations, kindOf: () => undefined };
    const call = { id: "c", name: "file_read", argumentsText: '{"path":"a","limit":"2"}' };
    expect(repairCall(call, blind)).toBeUndefined();
  });

  it("answers no repair when what it read is longer than a call's arguments may be", () => {
    expect(loneHalves(15_000).length).toBeLessThan(maxArgumentsChars);
    const call = { id: "c", name: "notes_search", argumentsText: loneHalves(15_000) };
    expect(repairCall(call, tools)).toBeUndefined();
    expect(repairCall({ ...call, argumentsText: loneHalves(10_000) }, tools)).toMatchObject({
      steps: ["trailing_comma"],
    });
  });

  it("ends the repair on brackets nested past 64 inside a json string before any step walks them", () => {
    const list = `${"[".repeat(32_000)}${"]".repeat(32_000)}`;
    const argumentsText = JSON.stringify(`{"query":"x","list":${list}}`);
    const call = { id: "c", name: "notes_search", argumentsText };
    expect(call.argumentsText.length).toBeLessThan(maxArgumentsChars);
    // Time is fake in these tests, so the work is measured as the CPU time it takes.
    const before = process.cpuUsage();
    expect(repairCall(call, tools)).toBeUndefined();
    const spent = process.cpuUsage(before);
    // Read bracket by bracket, this depth takes over a second; the scan takes a millisecond.
    expect(spent.user + spent.system).toBeLessThan(200_000);
  });

  it.each(["propose", "control", "machine"] as const)(
    "leaves the values of a %s call as written while it repairs the form",
    (kind) => {
      const asKind: RepairTools = { declarations: box.declarations, kindOf: () => kind };
      const written = '```\n{"path":"a.txt","limit":"20","offset":null}\n```';
      const call = { id: "c", name: "file_read", argumentsText: written };
      expect(repairCall(call, asKind)).toStrictEqual({
        name: "file_read",
        argumentsText: '{"path":"a.txt","limit":"20","offset":null}',
        steps: ["fence"],
      });
    },
  );
});
