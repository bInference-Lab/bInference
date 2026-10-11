import { afterAll, describe, expect, it } from "vitest";
import { agentDatabase } from "../databases/agent-database.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

describe("the notes index in Chinese", () => {
  it("finds a note by three characters inside Chinese text with no spaces", () => {
    const { database } = databases.open(agentDatabase);
    const insert = database.prepare(
      "INSERT INTO notes (agent_id, text, origin, created_at, changed_at) VALUES ('agt_1', ?, 'owner', 1, 1)",
    );
    insert.run("主人喜欢稳定币，不喜欢高风险的土狗");
    insert.run("每天早上看一次行情");
    const search = (query: string): readonly unknown[] =>
      database
        .prepare("SELECT rowid FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rowid")
        .all(`"${query}"`)
        .map((row) => row["rowid"]);
    expect(search("稳定币")).toStrictEqual([1]);
    expect(search("看一次")).toStrictEqual([2]);
    expect(search("比特币")).toStrictEqual([]);
  });
});
