import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveStateFolder } from "./state-folder.js";

describe("state folder", () => {
  it("lives in the binference folder under the home folder", () => {
    const home = resolve("/home/owner");

    const folder = resolveStateFolder({ homeDir: home });

    expect(folder).toStrictEqual({
      root: join(home, ".binference"),
      configFile: join(home, ".binference", "config.json5"),
      engineDatabase: join(home, ".binference", "engine.sqlite"),
      agentDatabase: join(home, ".binference", "agent.sqlite"),
      keys: join(home, ".binference", "keys"),
      auth: join(home, ".binference", "auth"),
      workspace: join(home, ".binference", "workspace"),
      logs: join(home, ".binference", "logs"),
      run: join(home, ".binference", "run"),
      engineLock: join(home, ".binference", "engine.lock"),
    });
  });

  it("uses the account's home folder when none is given", () => {
    expect(resolveStateFolder().root).toBe(join(homedir(), ".binference"));
  });

  it("moves to BINFERENCE_HOME, normalized", () => {
    const moved = resolve("/srv/binference");

    const folder = resolveStateFolder({ binferenceHome: `${moved}/./`, homeDir: "/unused" });

    expect(folder.root).toBe(moved);
    expect(folder.engineLock).toBe(join(moved, "engine.lock"));
  });

  it("treats an empty BINFERENCE_HOME as unset", () => {
    const home = resolve("/home/owner");

    expect(resolveStateFolder({ binferenceHome: "", homeDir: home }).root).toBe(
      join(home, ".binference"),
    );
  });

  it("refuses a relative BINFERENCE_HOME", () => {
    expect(() => resolveStateFolder({ binferenceHome: "data/binference" })).toThrow(
      expect.objectContaining({ code: "platform.home_not_absolute" }),
    );
  });

  it("moves the workspace alone to BINFERENCE_WORKSPACE, normalized", () => {
    const moved = resolve("/srv/binference");
    const workspace = resolve("/srv/shared/workspace");

    const folder = resolveStateFolder({
      binferenceHome: moved,
      binferenceWorkspace: `${workspace}/./`,
    });

    expect(folder.workspace).toBe(workspace);
    expect(folder.root).toBe(moved);
    expect(folder.run).toBe(join(moved, "run"));
  });

  it("keeps the workspace in the state folder for an empty BINFERENCE_WORKSPACE", () => {
    const moved = resolve("/srv/binference");

    expect(resolveStateFolder({ binferenceHome: moved, binferenceWorkspace: "" }).workspace).toBe(
      join(moved, "workspace"),
    );
  });

  it("refuses a relative BINFERENCE_WORKSPACE", () => {
    expect(() => resolveStateFolder({ binferenceWorkspace: "workspace" })).toThrow(
      expect.objectContaining({
        code: "platform.workspace_not_absolute",
        details: { binferenceWorkspace: "workspace" },
      }),
    );
  });
});
