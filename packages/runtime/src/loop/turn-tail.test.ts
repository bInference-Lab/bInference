import { describe, expect, it } from "vitest";
import { createRelayLiveFacts } from "../relay/relay-live-facts.js";
import { nthTestId } from "../testing/memory-agent-stores.js";
import { createMemoryContextSource } from "../testing/memory-context-source.js";
import { callsReply, textReply } from "../testing/scripted-transport.js";
import { createTestTurn, type TestTool } from "./test-turns.js";

const agent = nthTestId("agt", 1);
const portfolio: TestTool = { name: "portfolio", kind: "read" };
const alert: TestTool = { name: "alert_create", kind: "control" };

describe("the volatile tail of a turn", () => {
  it("follows the history on every call, read again only after a batch that wrote", async () => {
    const source = createMemoryContextSource();
    const reads: number[] = [];
    const facts = createRelayLiveFacts(source, agent);
    const counted = {
      read: async (signal: AbortSignal) => {
        const read = await facts.read(signal);
        reads.push(source.factReads());
        return read;
      },
    };
    const { turn, transport } = createTestTurn({
      replies: [
        callsReply([{ name: "portfolio" }]),
        callsReply([{ name: "alert_create" }]),
        textReply("Done."),
      ],
      tools: [portfolio, alert],
      facts: counted,
    });
    await turn.run();
    expect(reads).toStrictEqual([1, 2]);
    expect(transport.requests.map((request) => request.tail?.split("\n")[0])).toStrictEqual([
      "Live facts from binference, read for this call. They are not the owner's words.",
      "Live facts from binference, read for this call. They are not the owner's words.",
      "Live facts from binference, read for this call. They are not the owner's words.",
    ]);
    expect(new Set(transport.requests.map((request) => request.prefix)).size).toBe(1);
  });

  it("says the facts could not be read, and the turn goes on", async () => {
    const source = createMemoryContextSource();
    source.link("down");
    const { turn, transport } = createTestTurn({
      replies: [textReply("Hi.")],
      facts: createRelayLiveFacts(source, agent),
    });
    await expect(turn.run()).resolves.toMatchObject({ state: "ended", outcome: "ok" });
    expect(transport.requests[0]?.tail).toContain("- The live facts could not be read now.");
  });

  it("tells the model budget left as the engine answered the turn's start", async () => {
    const { turn, transport } = createTestTurn({ replies: [textReply("Hi.")] });
    await turn.run();
    expect(transport.requests[0]?.tail).toMatch(/\n- Model budget left today: \$[\d.,]+\.$/u);
  });
});
