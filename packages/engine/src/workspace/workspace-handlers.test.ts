import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testAgent } from "../intents/test-intents.js";
import { startTestEngine, testCall, testCallers } from "../operations/test-engine.js";
import type { AgentStore } from "../ports.js";

const signal = (): AbortSignal => AbortSignal.timeout(1_000);
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
    const { handlers } = test.engine;
    const write = { agent: testAgent, file: "NOTES.md", text: "x" } as const;
    const edit = { agent: testAgent, file: "PERSONA.md", text: "x" } as const;
    const archived = { ok: false, error: "agent.archived" };
    expect(await handlers["agent/writeFile"](testCall(write))).toStrictEqual(archived);
    expect(await handlers["agent/editFile"](testCall(edit, testCallers.runtime))).toStrictEqual(
      archived,
    );
    expect(await handlers["agent/endFirstChat"](testCall({ agent: testAgent }))).toStrictEqual(
      archived,
    );
  });
});

async function textOf(test: Awaited<ReturnType<typeof startTestEngine>>, file: string) {
  const read = await test.engineOptions.workspace.read({ agent: testAgent, file }, signal());
  return read.ok ? read.value.text : undefined;
}

describe("the agent's own workspace writes", () => {
  const strategy = "# Strategy\n\n- Budget: 0.5 BNB, at most 0.05 BNB a trade.\n";
  const edit = { agent: testAgent, file: "STRATEGY.md", text: strategy } as const;

  it("writes the strategy from a runtime turn whose context holds no outside content", async () => {
    const test = await startTestEngine();
    const at = test.clock.now();
    const written = await test.engine.handlers["agent/editFile"](
      testCall(edit, testCallers.runtime),
    );
    expect(written).toStrictEqual({ ok: true, value: { updatedAt: at } });
    expect(await textOf(test, "STRATEGY.md")).toBe(strategy);
  });

  it.each([
    [
      "a turn that read outside content",
      { ...testCallers.runtime, turn: { hasOutsideContent: true } },
    ],
    ["a call outside any running turn", { ...testCallers.mcp, scopes: ["read", "agent"] as const }],
    ["the owner's own client", testCallers.cli],
  ])("refuses to write from %s, and keeps the file", async (_name, caller) => {
    const test = await startTestEngine();
    await test.engineOptions.workspace.write(
      { agent: testAgent, file: "STRATEGY.md" },
      "mine",
      signal(),
    );
    expect(await test.engine.handlers["agent/editFile"](testCall(edit, caller))).toStrictEqual({
      ok: false,
      error: "agent.file_untrusted",
    });
    expect(await textOf(test, "STRATEGY.md")).toBe("mine");
  });

  it("ends the first chat by removing its file, then answers file_missing", async () => {
    const test = await startTestEngine();
    const place = { agent: testAgent, file: "FIRST-CHAT.md" };
    await test.engineOptions.workspace.write(place, "# First chat\n", signal());
    const end = async () =>
      test.engine.handlers["agent/endFirstChat"](
        testCall({ agent: testAgent }, testCallers.runtime),
      );
    expect(await end()).toStrictEqual({ ok: true, value: {} });
    expect(await textOf(test, "FIRST-CHAT.md")).toBeUndefined();
    expect(await end()).toStrictEqual({ ok: false, error: "agent.file_missing" });
  });

  it("answers not_found for an agent the engine does not hold", async () => {
    const { engine } = await startTestEngine();
    const notFound = { ok: false, error: "agent.not_found" };
    expect(
      await engine.handlers["agent/editFile"](
        testCall({ ...edit, agent: other }, testCallers.runtime),
      ),
    ).toStrictEqual(notFound);
    expect(
      await engine.handlers["agent/endFirstChat"](testCall({ agent: other }, testCallers.runtime)),
    ).toStrictEqual(notFound);
  });
});
