import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { walledPaths } from "./command-wall-paths.js";
import { resolveStateFolder } from "./state-folder.js";

describe("walled paths", () => {
  it("walls the whole state folder and leaves the agent's workspace open", () => {
    const walled = walledPaths(resolveStateFolder({ binferenceHome: "/srv/binference" }));
    expect(walled).toStrictEqual({
      roots: ["/srv/binference"],
      open: ["/srv/binference/workspace"],
    });
  });

  describe("a state folder reached through a link", () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "binference-wall-")));
    const real = join(base, "real-home");
    mkdirSync(real);
    const linked = join(base, "linked-home");
    symlinkSync(real, linked);
    afterAll(() => {
      rmSync(base, { recursive: true, force: true });
    });

    it("walls it at its resolved path as well as the given one", () => {
      const walled = walledPaths(resolveStateFolder({ binferenceHome: linked }));
      expect(walled).toStrictEqual({
        roots: [linked, real],
        open: [join(linked, "workspace"), join(real, "workspace")],
      });
    });
  });
});
