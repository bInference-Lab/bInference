import { join } from "node:path";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { sha256Hex } from "@binference/engine";
import { createMemoryEngineStores } from "@binference/engine/testing";
import { readTextFile, writePrivateFile } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { clientTokenSchema } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { ensureCliToken, readCliToken } from "./cli-token.js";

const folders: TempFolder[] = [];
const permissions = {
  restrictFolder: async () => Promise.resolve(),
  restrictFile: async () => Promise.resolve(),
};
const signal = new AbortController().signal;

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

async function setup() {
  const folder = await createTempFolder("bnf-tok-");
  folders.push(folder);
  const access = createMemoryEngineStores().access;
  const file = join(folder.path, "auth", "cli.token");
  const options = {
    access,
    file,
    permissions,
    clock: createManualClock(1_800_000_000_000),
    random: createSeededRandom(3),
    signal,
  };
  return { access, file, options };
}

describe("the CLI's token", () => {
  it("writes a new token to its file and stores only its hash", async () => {
    const { access, file, options } = await setup();
    await expect(ensureCliToken(options)).resolves.toBe("created");
    const token = clientTokenSchema.parse(await readCliToken(file, signal));
    const stored = await access.listTokens({ signal });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      kind: "cli",
      label: "cli",
      scopes: ["read", "propose", "chat", "confirm", "loosen", "admin"],
      secretHash: sha256Hex(token),
    });
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it("keeps a token the store knows", async () => {
    const { file, options } = await setup();
    await ensureCliToken(options);
    const first = await readTextFile(file, signal);
    await expect(ensureCliToken(options)).resolves.toBe("kept");
    await expect(readTextFile(file, signal)).resolves.toStrictEqual(first);
  });

  it("replaces a token the store revoked or never knew", async () => {
    const { access, file, options } = await setup();
    await ensureCliToken(options);
    const [record] = await access.listTokens({ signal });
    await access.revokeToken({ id: record?.id as never, atMs: 2 }, { signal });
    await expect(ensureCliToken(options)).resolves.toBe("created");
    await writePrivateFile(file, `bnt_${"Q".repeat(43)}\n`, { permissions, signal });
    await expect(ensureCliToken(options)).resolves.toBe("created");
    expect(await access.listTokens({ signal })).toHaveLength(3);
  });

  it("reads no token from a missing file, and names a path it cannot read", async () => {
    const { file } = await setup();
    await expect(readCliToken(file, signal)).resolves.toBeUndefined();
    await expect(readCliToken(join(file, "..", ".."), signal)).rejects.toMatchObject({
      code: "platform.file_read_failed",
    });
  });
});
