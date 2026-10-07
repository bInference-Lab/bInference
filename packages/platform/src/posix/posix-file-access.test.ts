import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fileAccessContract } from "../contracts/file-access-contract.js";
import { createTempFolder, type TempFolder } from "../fakes/temp-folder.js";
import { createPosixFileAccess } from "./posix-file-access.js";

const folders: TempFolder[] = [];

async function scratchFolder(): Promise<string> {
  const folder = await createTempFolder("bnf-");
  folders.push(folder);
  return folder.path;
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

describe.skipIf(process.platform === "win32")("posix file access", () => {
  it.each(
    fileAccessContract({
      create: async () => ({ access: createPosixFileAccess(), folder: await scratchFolder() }),
      readsAccess: true,
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("names a path it cannot read with a code", async () => {
    const file = join(await scratchFolder(), "config.json5");
    await writeFile(file, "{}");
    await expect(
      createPosixFileAccess().read(join(file, "inner"), new AbortController().signal),
    ).rejects.toMatchObject({ code: "platform.access_unreadable" });
  });
});
