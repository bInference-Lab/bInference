import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTempFolder } from "./fakes/temp-folder.js";
import { isFolder } from "./is-folder.js";
import { writeReadableFile } from "./readable-files.js";

describe("is folder", () => {
  it("says yes for a folder and no for a file or nothing", async () => {
    const temp = await createTempFolder("is-folder-");
    const file = join(temp.path, "note.txt");
    await writeReadableFile(file, new TextEncoder().encode("x"), AbortSignal.timeout(5_000));
    expect([isFolder(temp.path), isFolder(file), isFolder(join(temp.path, "gone"))]).toStrictEqual([
      true,
      false,
      false,
    ]);
    await temp.remove();
  });
});
