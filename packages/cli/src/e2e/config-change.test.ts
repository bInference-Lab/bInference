import { afterEach, describe, expect, it } from "vitest";
import { configText } from "./init-fixtures.js";
import { connectClient } from "./test-host.js";
import { createRunningEngines } from "./unlock-fixtures.js";

// config/change end to end: the CLI's client changes config.json5 through the engine that
// `binference start` runs, which edits the file in place and journals the change once, as the
// client's.
const slow = { timeout: 60_000 };
const engines = createRunningEngines();
const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(20_000) });

afterEach(async () => {
  await engines.stopAll();
});

// The machine's config.json5; a test that finds none fails.
async function fileText(machine: Parameters<typeof configText>[0]): Promise<string> {
  const text = await configText(machine);
  if (text === undefined) {
    throw new Error("The machine has no config.json5.");
  }
  return text;
}

describe("config/change on a running engine", () => {
  it(
    "adds one key to the file binference init wrote, keeps the rest, and journals it once",
    slow,
    async () => {
      const machine = await engines.setUp();
      await engines.start(machine);
      const before = await fileText(machine);
      const client = await connectClient(machine);
      const answer = await client.call(
        "config/change",
        { patch: { logging: { level: "debug" } }, reason: "Find the stuck order." },
        live(),
      );
      expect(answer.restartNeeded).toBe(false);
      expect(answer.config).toMatchObject({ logging: { level: "debug" } });
      const after = await fileText(machine);
      expect(after.split("\n").filter((line) => !before.split("\n").includes(line))).toStrictEqual([
        '  logging: { level: "debug" },',
      ]);
      expect(after.split("//")).toHaveLength(before.split("//").length);
      const history = await client.call("config/history", {}, live());
      expect(
        history.items.map(({ path, after: value, surface, reason }) => [
          path,
          value,
          surface,
          reason,
        ]),
      ).toStrictEqual([["logging.level", "debug", "cli", "Find the stuck order."]]);
    },
  );

  it("refuses a secret written as text and leaves the file as it was", slow, async () => {
    const machine = await engines.setUp();
    await engines.start(machine);
    const before = await configText(machine);
    const client = await connectClient(machine);
    await expect(
      client.call(
        "config/change",
        { patch: { telegram: { botToken: "123456:AAAA-secret" } } },
        live(),
      ),
    ).rejects.toMatchObject({ code: "config.secret_inline" });
    expect(await configText(machine)).toBe(before);
  });
});
