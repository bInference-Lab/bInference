import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { ToolCall } from "../loop/model-message.js";
import type { ToolBox } from "../loop/ports.js";

/** A fresh tool box, and a call to one of its tools that passes that tool's check. */
export interface ToolBoxSubject {
  readonly box: ToolBox;
  readonly call: ToolCall;
}

/** Makes a fresh subject for each check. */
export interface ToolBoxHarness {
  create(): Promise<ToolBoxSubject>;
}

async function declaresAndReadies(harness: ToolBoxHarness): Promise<void> {
  const { box, call } = await harness.create();
  const names = box.declarations.map((declaration) => declaration.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes(call.name));
  assert.equal(box.prepare(call).ready, true);
}

async function refusesWithoutThrowing(harness: ToolBoxHarness): Promise<void> {
  const { box, call } = await harness.create();
  const refusals = [
    { ...call, name: "no_such_tool" },
    { ...call, argumentsText: "{" },
  ].map((each) => box.prepare(each));
  for (const refused of refusals) {
    assert.equal(refused.ready, false);
    assert.ok(!refused.ready && refused.text.length > 0);
  }
  const causes = refusals.map((refused) => (refused.ready ? undefined : refused.cause));
  assert.deepEqual(causes, ["name", "arguments"]);
}

async function answersEachKind(harness: ToolBoxHarness): Promise<void> {
  const { box, call } = await harness.create();
  const prepared = box.prepare(call);
  assert.equal(box.kindOf(call.name), prepared.ready ? prepared.kind : undefined);
  assert.equal(box.kindOf("no_such_tool"), undefined);
}

/**
 * The contract every {@link ToolBox} keeps (runtime spec, section 5.2): each tool is declared
 * once, a call that passes its check is ready, an unknown tool or unreadable arguments are
 * refused with a text the model reads and the cause a repair reads (decision 0447), never thrown,
 * and each declared tool's kind is answered by its name.
 */
export function toolBoxContract(harness: ToolBoxHarness): readonly ContractCheck[] {
  return [
    {
      name: "declares each tool once and readies a call that passes its check",
      run: async () => declaresAndReadies(harness),
    },
    {
      name: "refuses an unknown tool and unreadable arguments with a text and a cause, never a throw",
      run: async () => refusesWithoutThrowing(harness),
    },
    {
      name: "answers the kind of a declared tool by its name, and none for another",
      run: async () => answersEachKind(harness),
    },
  ];
}
