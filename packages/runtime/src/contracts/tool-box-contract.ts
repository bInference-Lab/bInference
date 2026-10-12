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
}

/**
 * The contract every {@link ToolBox} keeps (runtime spec, section 5.2): each tool is declared
 * once, a call that passes its check is ready, and an unknown tool or unreadable arguments are
 * refused with a text the model reads, never thrown.
 */
export function toolBoxContract(harness: ToolBoxHarness): readonly ContractCheck[] {
  return [
    {
      name: "declares each tool once and readies a call that passes its check",
      run: async () => declaresAndReadies(harness),
    },
    {
      name: "refuses an unknown tool and unreadable arguments with a text, never a throw",
      run: async () => refusesWithoutThrowing(harness),
    },
  ];
}
