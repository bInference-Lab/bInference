import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testAgent } from "../intents/test-intents.js";
import { startTestEngine, testCall, testCallers } from "../operations/test-engine.js";
import type { AgentStore } from "../ports.js";

const other = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000099");

// An agent store that reads every agent back as archived.
function archivedAgents(store: AgentStore): AgentStore {
  return {
    ...store,
    async get(id, options) {
      const settings = await store.get(id, options);
      return settings === undefined
        ? undefined
        : { ...settings, agent: { ...settings.agent, archivedAtMs: 1 } };
    },
  };
}

describe("the workspace handlers", () => {
  it("writes a file whole and reads it back with the time it changed", async () => {
    const test = await startTestEngine();
    const { handlers } = test.engine;
    const text = "# Rules\nNever buy a token with a tax above 10%.\n";
    const args = { agent: testAgent, file: "RULES.md", text } as const;
    const at = test.clock.now();
    const written = await handlers["agent/writeFile"](testCall(args));
    const read = await handlers["agent/readFile"](
      testCall({ agent: testAgent, file: "RULES.md" }, testCallers.runtime),
    );
    expect(written).toStrictEqual({ ok: true, value: { updatedAt: at } });
    expect(read).toStrictEqual({ ok: true, value: { text, updatedAt: at } });
  });

  it("answers file_missing for a file the agent does not have", async () => {
    const { engine } = await startTestEngine();
    const read = await engine.handlers["agent/readFile"](
      testCall({ agent: testAgent, file: "FIRST-CHAT.md" }),
    );
    expect(read).toStrictEqual({ ok: false, error: "agent.file_missing" });
  });

  it("answers not_found for an agent the engine does not hold, and writes nothing", async () => {
    const test = await startTestEngine();
    const { handlers } = test.engine;
    const write = { agent: other, file: "NOTES.md", text: "x" } as const;
    expect(await handlers["agent/writeFile"](testCall(write))).toStrictEqual({
      ok: false,
      error: "agent.not_found",
    });
    expect(
      await test.engineOptions.workspace.read(
        { agent: other, file: "NOTES.md" },
        AbortSignal.timeout(1_000),
      ),
    ).toStrictEqual({ ok: false, error: "not_found" });
    expect(
      await handlers["agent/readFile"](testCall({ agent: other, file: "NOTES.md" })),
    ).toStrictEqual({
      ok: false,
      error: "agent.not_found",
    });
  });

  it("refuses to write the files of an archived agent", async () => {
    const test = await startTestEngine({ agents: archivedAgents });
    const write = { agent: testAgent, file: "NOTES.md", text: "x" } as const;
    expect(await test.engine.handlers["agent/writeFile"](testCall(write))).toStrictEqual({
      ok: false,
      error: "agent.archived",
    });
  });
});
