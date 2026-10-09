import { describe, expect, it } from "vitest";
import { createMemoryConfigJournal } from "../fakes/memory-config-journal.js";
import { testCallers } from "../operations/test-engine.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";
import { authorOf, journalConfigChange } from "./journal-config-change.js";

const live = () => ({ signal: new AbortController().signal });

describe("journaling a config change", () => {
  it("records who changed what and where, pushes the entry, then announces it", async () => {
    const journal = createMemoryConfigJournal();
    const pushes: EnginePush[] = [];
    const notice = noticePush({ key: "notice.limitChange", values: {} });
    const entry = await journalConfigChange(
      { journal, publish: (push) => pushes.push(push) },
      {
        author: authorOf(testCallers.cli),
        atMs: 5,
        path: "agents.main.limits",
        before: { perTradeUsd: "50" },
        after: { perTradeUsd: "100" },
        notices: [notice],
      },
      live(),
    );
    expect(entry).toMatchObject({
      atMs: 5,
      by: testCallers.cli.credential,
      surface: "cli",
      path: "agents.main.limits",
      before: { perTradeUsd: "50" },
      after: { perTradeUsd: "100" },
    });
    await expect(journal.list({ after: 0, limit: 10 }, live())).resolves.toStrictEqual([entry]);
    expect(pushes).toStrictEqual([
      { topic: "config", kind: "config/changed", data: entry },
      notice,
    ]);
  });

  it("leaves out a value that was or is no more", async () => {
    const journal = createMemoryConfigJournal();
    const entry = await journalConfigChange(
      { journal, publish: () => undefined },
      {
        author: authorOf(testCallers.cli),
        atMs: 6,
        path: "agents.main.addressBook.adr_1",
        before: "x",
      },
      live(),
    );
    expect(entry).not.toHaveProperty("after");
  });
});
