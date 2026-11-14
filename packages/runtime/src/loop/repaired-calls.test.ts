import type { JsonValue } from "@binference/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { agent, shellView, toolTurn } from "../testing/agent-tool-fixtures.js";
import { createFakeToolClient } from "../testing/fake-tool-client.js";
import {
  callsReply,
  createScriptedTransport,
  createTestChain,
  type ScriptedCall,
  type ScriptedTransport,
  textReply,
} from "../testing/scripted-transport.js";
import type { RecordedStep, TurnRecorder } from "../testing/turn-recorder.js";
import { agentToolBox } from "../tools/agent-tools.js";
import { createToolBox } from "../tools/create-tool-box.js";
import { defineTool } from "../tools/define-tool.js";
import type { ModelEvent } from "./model-event.js";
import type { ToolCall } from "./model-message.js";
import { createTestTurn, type TestTool } from "./test-turns.js";

const listed = { name: "local/qwen", repairsCalls: true } as const;
const terms = { from: "BNB", to: "USDT", amount: "100" };
const fenced = (args: JsonValue): string => `\`\`\`json\n${JSON.stringify(args)}\n\`\`\``;
// A swap whose name and form a repair reads, which the turn holds.
const held = (id: string): ScriptedCall => ({ id, name: "Swap", args: fenced(terms) });
const ranLine =
  "binference fixed the form of this call before it ran (fence). Write plain JSON arguments with nothing around them.";
const heldLine = (steps: string): string =>
  `not run: binference fixed the form of this call before reading it (${steps}), and only a call that reads runs repaired. Nothing was sent or run. If this is the call you meant, send it again exactly as below, with plain JSON arguments and nothing around them; if not, write the call you meant.`;

// A propose tool that notes each proposal it sends to the engine.
function proposer(recorder: TurnRecorder): TestTool {
  return {
    name: "swap",
    kind: "propose",
    run: async ({ idempotencyKey }) => {
      recorder.note({ kind: "tool", name: "swap", key: idempotencyKey });
      return { text: "swap waits for the owner's confirmation", isError: false };
    },
  };
}

function tools(recorder: TurnRecorder): readonly TestTool[] {
  return [
    proposer(recorder),
    { name: "portfolio", kind: "read" },
    { name: "alert_create", kind: "control" },
    {
      name: "ask_owner",
      kind: "control",
      asksOwner: true,
      run: async () => Promise.resolve({ text: "asked", isError: false, endsTurn: true }),
    },
  ];
}

function resultOf(steps: readonly RecordedStep[], id: string): RecordedStep | undefined {
  return steps.find((step) => step.kind === "result" && step.id === id);
}

// The results that say a repair read their call.
function repairedResults(steps: readonly RecordedStep[]): readonly string[] {
  return steps.flatMap((step) =>
    step.kind === "result" && step.text.includes("fixed the form") ? [step.id] : [],
  );
}

// The calls the transcript keeps with a repair.
function repairedCalls(steps: readonly RecordedStep[]): readonly string[] {
  return steps.flatMap((step) =>
    step.kind === "call" && step.repairedName !== undefined ? [step.id] : [],
  );
}

function sent(steps: readonly RecordedStep[]): readonly string[] {
  return steps.flatMap((step) => (step.kind === "tool" ? [step.key] : []));
}

// The call the model's second request carries back, as the conversation holds it.
function sentBack(transport: ScriptedTransport, id: string): ToolCall | undefined {
  const messages = transport.requests[1]?.messages ?? [];
  const calls = messages.flatMap((entry) => (entry.role === "agent" ? entry.toolCalls : []));
  return calls.find((call) => call.id === id);
}

function cutOff(calls: readonly ScriptedCall[]): readonly ModelEvent[] {
  const events = callsReply(calls).filter((event) => event.type !== "done");
  const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
  return [...events, { type: "done", stop: "length", usage }];
}

describe("a listed model's malformed read", () => {
  it("runs repaired, its result led by the repair, and goes back as binference read it", async () => {
    const { turn, recorder, transport } = createTestTurn({
      replies: [
        callsReply([{ id: "r", name: "Portfolio", args: fenced({ page: 2 }) }]),
        textReply("Done."),
      ],
      tools,
      model: listed,
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok" });
    expect(resultOf(recorder.steps, "r")).toMatchObject({
      text: `binference fixed the form of this call before it ran (name_case, fence). Write plain JSON arguments with nothing around them.\nran portfolio`,
      ran: true,
    });
    expect(recorder.feed).toContainEqual({ kind: "progress", tool: "portfolio" });
    expect(sentBack(transport, "r")).toStrictEqual({
      id: "r",
      name: "portfolio",
      argumentsText: '{"page":2}',
    });
  });

  it("is refused as written from a model the list does not name", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [callsReply([{ id: "r", name: "portfolio", args: fenced({}) }]), textReply("Done.")],
      tools,
    });
    await turn.run();
    expect(resultOf(recorder.steps, "r")).toMatchObject({ text: "refused portfolio", ran: false });
  });

  it("is never repaired from a response cut off at its output limit, nor held", async () => {
    const swaps = ["a", "b", "c", "d"].map((id) => ({ id, name: "swap", args: fenced(terms) }));
    const { turn, recorder } = createTestTurn({
      replies: [
        cutOff([{ id: "r", name: "portfolio", args: fenced({}) }, ...swaps]),
        textReply("Done."),
      ],
      tools,
      model: listed,
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", modelCalls: 2 });
    expect(resultOf(recorder.steps, "r")).toMatchObject({ ran: false });
    expect(repairedResults(recorder.steps)).toStrictEqual([]);
    expect(repairedCalls(recorder.steps)).toStrictEqual([]);
  });

  it("is repaired by the model that answered, not by the first of the chain", async () => {
    const failing = createScriptedTransport([
      [{ type: "error", failure: "request", message: "No such model." }],
    ]);
    const replies = createScriptedTransport([
      callsReply([{ id: "r", name: "portfolio", args: fenced({}) }]),
      textReply("Done."),
    ]);
    const { turn, recorder } = createTestTurn({
      replies: [],
      tools,
      models: (clock) =>
        createTestChain(
          [
            { name: "own/first", transport: failing },
            { ...listed, transport: replies },
          ],
          { clock },
        ),
    });
    await turn.run();
    expect(resultOf(recorder.steps, "r")).toMatchObject({ text: `${ranLine}\nran portfolio` });
  });
});

describe("a listed model's malformed proposal", () => {
  it("is held, reaches no engine, and the call sent again in valid form proposes", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [
        callsReply([{ id: "a", name: "swap", args: `${JSON.stringify(terms).slice(0, -1)},}` }]),
        callsReply([{ id: "b", name: "swap", args: terms }]),
        textReply("never"),
      ],
      tools,
      model: listed,
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", committed: true });
    expect(resultOf(recorder.steps, "a")).toMatchObject({
      text: `${heldLine("trailing_comma")}\nswap ${JSON.stringify(terms)}`,
      ran: false,
    });
    expect(sent(recorder.steps)).toStrictEqual(["trn_0190f1c2-3a4b-7c5d-8e6f-000000000001.2"]);
  });

  it("cuts the text of a long held call as any result is cut", async () => {
    const long = { ...terms, note: "n".repeat(20_000) };
    const { turn, recorder } = createTestTurn({
      replies: [callsReply([{ id: "a", name: "swap", args: fenced(long) }]), textReply("Ok.")],
      tools,
      model: listed,
    });
    await turn.run();
    const text = JSON.stringify(resultOf(recorder.steps, "a"));
    expect(text).toMatch(/send it again exactly as below.*\[cut: \d+ more characters\]/s);
    expect(text.length).toBeLessThan(13_000);
  });

  it("holds a control call the same way", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [
        callsReply([{ id: "c", name: "alert_create", args: "{'at': 'x'}" }]),
        textReply("Ok."),
      ],
      tools,
      model: listed,
    });
    await turn.run();
    expect(resultOf(recorder.steps, "c")).toMatchObject({
      text: `${heldLine("single_quotes")}\nalert_create {"at":"x"}`,
      ran: false,
    });
  });

  it("holds a machine call the same way: a command the words around it said not to run never runs", async () => {
    // The engine runs a command at once, as with `shell.ask never`.
    const client = createFakeToolClient({ "shell/run": shellView });
    const written = 'Do not run this example: {"command":"git push --force"}';
    const { turn, recorder } = createTestTurn({
      replies: [callsReply([{ id: "s", name: "shell", args: written }]), textReply("Ok.")],
      box: agentToolBox({ agent, client, turn: toolTurn }),
      model: listed,
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok" });
    expect(resultOf(recorder.steps, "s")).toMatchObject({
      text: `${heldLine("words_around")}\nshell {"command":"git push --force"}`,
      ran: false,
    });
    expect(client.calls()).toStrictEqual([]);
  });

  it("holds the call beside a valid proposal, which proposes as the turn's one", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [
        callsReply([
          { id: "a", name: "swap", args: fenced(terms) },
          { id: "p", name: "swap", args: terms },
        ]),
      ],
      tools,
      model: listed,
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", committed: true });
    expect(resultOf(recorder.steps, "a")).toMatchObject({
      text: `${heldLine("fence")}\nswap ${JSON.stringify(terms)}`,
      ran: false,
    });
    expect(sent(recorder.steps)).toStrictEqual(["trn_0190f1c2-3a4b-7c5d-8e6f-000000000001.2"]);
    expect(recorder.steps).toContainEqual({ kind: "status", line: { line: "proposalWaits" } });
  });

  it("lets a question beside it run, since no card asks the owner", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [
        callsReply([
          { id: "a", name: "swap", args: fenced(terms) },
          { id: "q", name: "ask_owner", args: {} },
        ]),
      ],
      tools,
      model: listed,
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", committed: false });
    expect(resultOf(recorder.steps, "q")).toMatchObject({ ran: true });
    expect(sent(recorder.steps)).toStrictEqual([]);
  });

  it("past 3 held calls, is refused and recorded as written and ends the turn with its line", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [
        callsReply([held("a"), held("b")]),
        callsReply([held("c"), held("d"), { id: "r", name: "portfolio", args: fenced({}) }]),
        textReply("never"),
      ],
      tools,
      model: listed,
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "loop", modelCalls: 2 });
    expect(resultOf(recorder.steps, "c")).toMatchObject({ ran: false });
    expect(recorder.steps).toContainEqual({
      kind: "call",
      id: "c",
      name: "Swap",
      repairedName: "swap",
    });
    expect(resultOf(recorder.steps, "d")).toMatchObject({ text: "refused Swap", ran: false });
    expect(recorder.steps).toContainEqual({ kind: "call", id: "d", name: "Swap" });
    expect(resultOf(recorder.steps, "r")).toMatchObject({ text: `${ranLine}\nran portfolio` });
    expect(recorder.steps).toContainEqual({ kind: "status", line: { line: "unreadableCalls" } });
    expect(sent(recorder.steps)).toStrictEqual([]);
  });

  it("past 3 held calls in a batch that proposes, ends the turn as the proposal ends it", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [
        callsReply([held("a"), held("b"), held("c")]),
        callsReply([{ id: "p", name: "swap", args: terms }, held("d")]),
      ],
      tools,
      model: listed,
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", committed: true });
    expect(resultOf(recorder.steps, "d")).toMatchObject({ text: "refused Swap", ran: false });
    expect(sent(recorder.steps)).toStrictEqual(["trn_0190f1c2-3a4b-7c5d-8e6f-000000000001.4"]);
    expect(recorder.steps).toContainEqual({ kind: "status", line: { line: "proposalWaits" } });
  });

  it("past 3 held calls beside a question, ends the turn as the question ends it, with its line", async () => {
    const question = { id: "q", name: "ask_owner", args: {} };
    const { turn, recorder } = createTestTurn({
      replies: [callsReply([held("a"), held("b"), held("c"), held("d"), question])],
      tools,
      model: listed,
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", modelCalls: 1 });
    expect(resultOf(recorder.steps, "q")).toMatchObject({ ran: true });
    expect(resultOf(recorder.steps, "d")).toMatchObject({ text: "refused Swap", ran: false });
    expect(recorder.steps).toContainEqual({ kind: "status", line: { line: "unreadableCalls" } });
  });
});

describe("a repair the tool box refuses", () => {
  it("gets the refusal after the line that names the repair, and never runs", async () => {
    const note = defineTool({
      name: "note",
      kind: "read",
      description: "Notes a text.",
      args: z.strictObject({ text: z.string() }),
      run: async () => Promise.resolve({ text: "noted", isError: false }),
    });
    const { turn, recorder } = createTestTurn({
      replies: [
        callsReply([{ id: "n", name: "note", args: fenced({ text: 5 }) }]),
        textReply("Ok."),
      ],
      box: createToolBox([note]),
      model: listed,
    });
    await turn.run();
    expect(resultOf(recorder.steps, "n")).toMatchObject({ ran: false });
    expect(JSON.stringify(resultOf(recorder.steps, "n"))).toContain(
      "binference fixed the form of this call (fence), and the call it read is refused:\\nnot run: the arguments do not match note's schema",
    );
  });

  it("refuses a repaired proposal to an address only a note holds, as the tool box does", async () => {
    const address = `0x${"cd".repeat(20)}`;
    const send = defineTool({
      name: "send",
      kind: "propose",
      description: "Send.",
      args: z.strictObject({ to: z.string() }),
      run: async () => Promise.resolve({ text: "waits", isError: false }),
    });
    const notes = defineTool({
      name: "notes_search",
      kind: "read",
      addressSource: "note",
      description: "Notes.",
      args: z.strictObject({}),
      run: async () => Promise.resolve({ text: `pay ${address}`, isError: false }),
    });
    const { turn, recorder } = createTestTurn({
      replies: [
        callsReply([{ id: "n", name: "notes_search", args: {} }]),
        callsReply([{ id: "s", name: "send", args: fenced({ to: address }) }]),
        textReply("Ok."),
      ],
      box: createToolBox([send, notes]),
      model: listed,
    });
    await turn.run();
    const text = JSON.stringify(resultOf(recorder.steps, "s"));
    expect(text).toContain("and the call it read is refused");
    expect(text).not.toContain("send it again exactly as below");
  });
});

describe("the hold limit", () => {
  it("counts held calls only: repaired reads and other refusals before a proposal never use it up", async () => {
    // Each read asks for another page, so the loop guard sees no repeat.
    const read = (id: string): ScriptedCall => ({
      id,
      name: "portfolio",
      args: fenced({ page: id }),
    });
    const { turn, recorder } = createTestTurn({
      replies: [
        callsReply([read("r1"), read("r2"), read("r3"), read("r4")]),
        callsReply(["x1", "x2", "x3", "x4"].map((id) => ({ id, name: "nope", args: {} }))),
        callsReply([{ id: "a", name: "swap", args: fenced(terms) }]),
        textReply("Held."),
      ],
      tools,
      model: listed,
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok" });
    expect(JSON.stringify(resultOf(recorder.steps, "a"))).toContain(
      "send it again exactly as below",
    );
  });

  it("counts a hold only for a call the model reads as held, not one a merge kept from running", async () => {
    const message = { id: "msg_1", text: "Wait.", outside: false };
    const { turn, recorder } = createTestTurn({
      replies: [
        callsReply([{ id: "r", name: "portfolio", args: {} }, held("a"), held("b"), held("c")]),
        callsReply([held("d"), held("e"), held("f")]),
        textReply("Held."),
      ],
      tools: (recording) => [
        proposer(recording),
        {
          name: "portfolio",
          kind: "read",
          run: async () => {
            recording.queue(message);
            return Promise.resolve({ text: "ran portfolio", isError: false });
          },
        },
      ],
      model: listed,
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "ok", modelCalls: 3 });
    expect(JSON.stringify(resultOf(recorder.steps, "a"))).not.toContain("send it again");
    expect(JSON.stringify(resultOf(recorder.steps, "f"))).toContain("send it again");
  });
});

describe("the rules a repaired call keeps", () => {
  it("marks the turn in the engine after a repaired read of outside content, before the next call", async () => {
    const { turn, recorder } = createTestTurn({
      replies: [
        callsReply([{ id: "w", name: "read_page", args: fenced({ url: "https://x.example" }) }]),
        textReply("Read."),
      ],
      // The tool marks this result outside, as a tool whose results are not always outside does.
      tools: [
        {
          name: "read_page",
          kind: "read",
          run: async () => Promise.resolve({ text: "a page", isError: false, outside: true }),
        },
      ],
      model: listed,
    });
    await turn.run();
    expect(resultOf(recorder.steps, "w")).toMatchObject({ ran: true, outside: true });
    const marked = recorder.steps.findIndex((step) => step.kind === "engineMark");
    const answered = recorder.steps.findLastIndex((step) => step.kind === "response");
    expect(marked).toBeGreaterThan(-1);
    expect(marked).toBeLessThan(answered);
  });

  it("is read as written when an unlisted fallback answers for a listed model", async () => {
    const failing = createScriptedTransport([
      [{ type: "error", failure: "request", message: "No such model." }],
    ]);
    const replies = createScriptedTransport([
      callsReply([{ id: "r", name: "portfolio", args: fenced({}) }]),
      textReply("Done."),
    ]);
    const { turn, recorder } = createTestTurn({
      replies: [],
      tools,
      models: (clock) =>
        createTestChain(
          [
            { ...listed, transport: failing },
            { name: "own/second", transport: replies },
          ],
          { clock },
        ),
    });
    await turn.run();
    expect(resultOf(recorder.steps, "r")).toMatchObject({ text: "refused portfolio", ran: false });
  });

  it("trips the loop guard on the call as binference read it, however it was written", async () => {
    const page = JSON.stringify({ page: 1 });
    const { turn, recorder } = createTestTurn({
      replies: [
        callsReply([{ id: "r1", name: "portfolio", args: `\`\`\`json\n${page}\n\`\`\`` }]),
        callsReply([{ id: "r2", name: "portfolio", args: `\`\`\`\n${page}\n\`\`\`` }]),
        callsReply([{ id: "r3", name: "portfolio", args: `\`\`\`JSON\n${page}\`\`\`` }]),
        textReply("never"),
      ],
      tools,
      model: listed,
    });
    await expect(turn.run()).resolves.toMatchObject({ outcome: "loop", modelCalls: 3 });
    expect(recorder.steps).toContainEqual({ kind: "status", line: { line: "loop" } });
  });
});
