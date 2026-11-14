import type { JsonValue } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { callsReply, type ScriptedCall, textReply } from "../testing/scripted-transport.js";
import type { RecordedStep, TurnRecorder } from "../testing/turn-recorder.js";
import { createTestTurn, type TestTool } from "./test-turns.js";

// Runtime spec, invariant 11, and decision 0447, over generated turns of a listed model: whatever
// form its calls take, no call but a read runs from repaired arguments. Each one that ran was
// written in valid form, and each one written malformed got a result that never ran.

type Form = "valid" | "fence" | "trailing_comma" | "single_quotes" | "garbage";
const names = ["swap", "alert_create", "shell", "portfolio"] as const;

const writtenAs: Readonly<Record<Form, (tag: string) => string>> = {
  valid: (tag) => JSON.stringify({ tag }),
  fence: (tag) => `\`\`\`json\n${JSON.stringify({ tag })}\n\`\`\``,
  trailing_comma: (tag) => `{"tag":"${tag}",}`,
  single_quotes: (tag) => `{'tag': '${tag}'}`,
  garbage: (tag) => `tag=${tag}`,
};

function tagOf(args: JsonValue): string {
  const isObject = typeof args === "object" && args !== null && !Array.isArray(args);
  const tag = isObject ? (args as { readonly [key: string]: JsonValue })["tag"] : undefined;
  return typeof tag === "string" ? tag : "";
}

// A tool that is not a read notes the call it ran by the tag its arguments carry.
function noting(
  recorder: TurnRecorder,
  name: string,
  kind: "propose" | "control" | "machine",
): TestTool {
  return {
    name,
    kind,
    run: async (_context, args) => {
      recorder.note({ kind: "tool", name, key: tagOf(args) });
      return Promise.resolve({ text: "taken", isError: false });
    },
  };
}

function tools(recorder: TurnRecorder): readonly TestTool[] {
  return [
    noting(recorder, "swap", "propose"),
    noting(recorder, "alert_create", "control"),
    noting(recorder, "shell", "machine"),
    { name: "portfolio", kind: "read" },
  ];
}

const call = fc.record({
  name: fc.constantFrom(...names),
  form: fc.constantFrom<Form>("valid", "fence", "trailing_comma", "single_quotes", "garbage"),
});
const batches = fc.array(fc.array(call, { minLength: 1, maxLength: 4 }), {
  minLength: 1,
  maxLength: 4,
});

/** A generated turn's calls as the model writes them, and the form of each, by its id. */
interface Script {
  readonly calls: readonly (readonly ScriptedCall[])[];
  /** The ids of the calls that are not reads, each with whether it was written valid. */
  readonly changing: ReadonlyMap<string, boolean>;
}

function scriptOf(
  generated: readonly (readonly { readonly name: string; readonly form: Form }[])[],
): Script {
  const changing = new Map<string, boolean>();
  const calls = generated.map((batch, at) =>
    batch.map(({ name, form }, place) => {
      const id = `c${String(at)}_${String(place)}`;
      if (name !== "portfolio") {
        changing.set(id, form === "valid");
      }
      return { id, name, args: writtenAs[form](id) };
    }),
  );
  return { calls, changing };
}

/** The calls that are not reads that ran and were not written valid, by two records. */
interface Breaches {
  /** The tags of the calls whose tools ran though written malformed. */
  readonly ranTools: readonly string[];
  /** The ids of the calls written malformed whose result says they ran. */
  readonly ranResults: readonly string[];
}

function breachesOf(steps: readonly RecordedStep[], script: Script): Breaches {
  const isMalformed = (id: string): boolean => script.changing.get(id) === false;
  return {
    ranTools: steps.flatMap((step) =>
      step.kind === "tool" && isMalformed(step.key) ? [step.key] : [],
    ),
    ranResults: steps.flatMap((step) =>
      step.kind === "result" && step.ran && isMalformed(step.id) ? [step.id] : [],
    ),
  };
}

describe("the calls of a listed model", () => {
  it("never run a call but a read from repaired arguments", async () => {
    await fc.assert(
      fc.asyncProperty(batches, async (generated) => {
        const script = scriptOf(generated);
        const { turn, recorder } = createTestTurn({
          replies: [...script.calls.map((each) => callsReply(each)), textReply("Done.")],
          tools,
          model: { name: "local/qwen", repairsCalls: true },
        });
        await turn.run();
        expect(breachesOf(recorder.steps, script)).toStrictEqual({ ranTools: [], ranResults: [] });
      }),
    );
  });
});
