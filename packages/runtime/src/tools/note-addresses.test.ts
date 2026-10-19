import type { JsonValue } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { ModelMessage } from "../loop/model-message.js";
import { createTestTurn, ownerMessage } from "../loop/test-turns.js";
import { summaryMessage } from "../sessions/conversation.js";
import { agent, coin, coinInfo, intentWire, toolTurn } from "../testing/agent-tool-fixtures.js";
import { createFakeToolClient } from "../testing/fake-tool-client.js";
import { callsReply, textReply } from "../testing/scripted-transport.js";
import { agentToolBox } from "./agent-tools.js";
import { addressesIn, noteAddressRefusal, noteOnlyAddress } from "./note-addresses.js";

const address = "0x55d398326f99059fF775485246999027B3197955";
const lower = address.toLowerCase();
const usdt = `eip155:56/erc20:${address}`;
const tools = { engine: new Set(["token_search"]), notes: new Set(["notes_search"]) };
const swap = JSON.stringify({ from: coin, to: usdt, amount: { base: "1000" }, reason: "r" });

function noteResult(text: string): readonly ModelMessage[] {
  return [
    {
      role: "agent",
      text: "",
      reasoning: "",
      toolCalls: [{ id: "n1", name: "notes_search", argumentsText: '{"query":"usdt"}' }],
    },
    { role: "tool", callId: "n1", name: "notes_search", text, isError: false },
  ];
}

function searchResult(query: string, text: string): readonly ModelMessage[] {
  const argumentsText = JSON.stringify({ chain: "eip155:56", query });
  return [
    {
      role: "agent",
      text: "",
      reasoning: "",
      toolCalls: [{ id: "s1", name: "token_search", argumentsText }],
    },
    { role: "tool", callId: "s1", name: "token_search", text, isError: false },
  ];
}

const fromNote = noteResult(`- note 1 [agent]: USDT is ${address}`);

describe("noteOnlyAddress", () => {
  it("reads each EVM address once, in lower case, and no longer hex run", () => {
    const hash = `0x${"ab".repeat(32)}`;
    expect([...addressesIn(`${address} and ${lower}, not ${hash}`)]).toStrictEqual([lower]);
  });

  it("finds an address only a note holds, in any letter case", () => {
    expect(noteOnlyAddress(swap.toLowerCase(), fromNote, tools)).toBe(lower);
  });

  it.each([
    ["the owner's own message", [{ role: "owner", text: `Buy ${address}` }]],
    ["an engine read that found it", searchResult("USDT", `{"items":[{"asset":"${usdt}"}]}`)],
  ] as const)("lets an address through that %s holds too", (_name, source) => {
    expect(noteOnlyAddress(swap, [...fromNote, ...source], tools)).toBeUndefined();
  });

  it.each([
    ["an engine read that was given it", searchResult(address, `{"items":[{"asset":"${usdt}"}]}`)],
    ["the summary of earlier history", [summaryMessage(`The owner bought ${address}.`)]],
  ] as const)("refuses an address a note holds that only %s repeats", (_name, echo) => {
    expect(noteOnlyAddress(swap, [...fromNote, ...echo], tools)).toBe(lower);
  });

  it("lets a proposal through that names no address, or one no note holds", () => {
    expect(noteOnlyAddress('{"to":"fake:1/token:0x0000000a"}', fromNote, tools)).toBeUndefined();
    expect(
      noteOnlyAddress(swap, noteResult("- note 1 [owner]: likes stablecoins"), tools),
    ).toBeUndefined();
  });
});

describe("a proposal with an address from a note", () => {
  const answers: Readonly<Record<string, JsonValue>> = {
    "notes/search": {
      items: [
        {
          note: "1",
          agent,
          text: `USDT is ${address}`,
          origin: "agent",
          createdAt: 1,
          changedAt: 1,
        },
      ],
    },
    "intent/propose": intentWire("awaiting_confirmation"),
    "asset/search": { items: [{ asset: coin, ...coinInfo }] },
  };

  it("is refused before it commits the turn, and the model reads how to find the address", async () => {
    const client = createFakeToolClient(answers);
    const swapArgs = { from: coin, to: usdt, amount: { base: "1000" }, reason: "As noted." };
    const { turn, recorder } = createTestTurn({
      box: agentToolBox({ agent, client, turn: toolTurn }),
      replies: [
        callsReply([{ id: "a", name: "notes_search", args: { query: "usdt" } }]),
        callsReply([{ id: "b", name: "swap", args: swapArgs }]),
        textReply("I need the address from you."),
      ],
    });
    await expect(turn.run()).resolves.toMatchObject({ committed: false, outcome: "ok" });
    expect(client.calls().map(({ op }) => op)).toStrictEqual(["notes/search"]);
    const results = recorder.steps.filter((step) => step.kind === "result");
    expect(results.map((step) => [step.id, step.text])).toStrictEqual([
      ["a", `- note 1 [agent]: USDT is ${address}`],
      ["b", noteAddressRefusal(lower)],
    ]);
  });

  it("runs once the owner's own message gives the address", async () => {
    const client = createFakeToolClient(answers);
    const swapArgs = { from: coin, to: usdt, amount: { base: "1000" }, reason: "You asked." };
    const { turn } = createTestTurn({
      box: agentToolBox({ agent, client, turn: toolTurn }),
      taken: [ownerMessage(1, `Swap into ${address}, the one in your notes`)],
      replies: [
        callsReply([{ id: "a", name: "notes_search", args: { query: "usdt" } }]),
        callsReply([{ id: "b", name: "swap", args: swapArgs }]),
      ],
    });
    await expect(turn.run()).resolves.toMatchObject({ committed: true });
    expect(client.calls().map(({ op }) => op)).toStrictEqual(["notes/search", "intent/propose"]);
  });
});
