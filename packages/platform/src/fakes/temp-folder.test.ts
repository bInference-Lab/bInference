import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTempFolder } from "./temp-folder.js";

describe("the temp folder", () => {
  it("creates a fresh folder and removes it with what it holds", async () => {
    const folder = await createTempFolder("bnf-tmp-");
    await writeFile(join(folder.path, "file.txt"), "x");
    await expect(stat(folder.path).then((info) => info.isDirectory())).resolves.toBe(true);
    await folder.remove();
    await expect(stat(folder.path)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
