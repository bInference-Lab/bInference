import { realpathSync } from "node:fs";
import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTempFolder, type TempFolder } from "./fakes/temp-folder.js";
import { realPlaceOf } from "./real-place-of.js";

const live = (): AbortSignal => new AbortController().signal;

describe("the real path of a place that may not exist yet", () => {
  let temp: TempFolder;
  let root: string;
  beforeEach(async () => {
    temp = await createTempFolder("real-place-");
    root = realpathSync(temp.path);
  });
  afterEach(async () => {
    await temp.remove();
  });

  it("resolves the nearest folder that exists and keeps the rest of the path after it", async () => {
    await mkdir(join(root, "real"));
    await symlink(join(root, "real"), join(root, "door"));
    await expect(realPlaceOf(join(root, "door", "a", "b.md"), live())).resolves.toBe(
      join(root, "real", "a", "b.md"),
    );
    await expect(realPlaceOf(join(root, "door"), live())).resolves.toBe(join(root, "real"));
  });
});
