import { describe, expect, it } from "vitest";
import { codexTable } from "./codex-server.js";

describe("codexTable", () => {
  it("writes each value as a TOML basic string, a Windows path and a quote escaped", () => {
    const table = codexTable({
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ['D:\\bin "x"\\main.mjs', "mcp", "--client", "codex"],
      env: {},
    });
    expect(table).toBe(
      [
        "[mcp_servers.binference]",
        'command = "C:\\\\Program Files\\\\nodejs\\\\node.exe"',
        'args = ["D:\\\\bin \\"x\\"\\\\main.mjs", "mcp", "--client", "codex"]',
      ].join("\n"),
    );
  });

  it("adds the environment as an inline table", () => {
    const table = codexTable({ command: "node", args: [], env: { BINFERENCE_HOME: "/srv/b" } });
    expect(table.split("\n").at(-1)).toBe('env = { BINFERENCE_HOME = "/srv/b" }');
  });
});
