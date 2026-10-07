import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecret, type SecretStore } from "@binference/core";
import { secretStoreContract } from "@binference/core/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createPlatform } from "../create-platform.js";
import { createFileSecretStore } from "./file-secret-store.js";

const folders: string[] = [];

async function keysFolder(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bnf-"));
  folders.push(root);
  return join(root, "keys");
}

afterEach(async () => {
  await Promise.all(
    folders
      .splice(0)
      .map(async (folder) => rm(folder, { recursive: true, maxRetries: 10, retryDelay: 200 })),
  );
});

function store(folder: string): SecretStore {
  return createFileSecretStore({ folder, permissions: createPlatform().permissions });
}

const signal = (): AbortSignal => new AbortController().signal;

async function readText(from: SecretStore, name: string): Promise<string | undefined> {
  const read = await from.read(name, signal());
  return read.ok ? read.value.reveal() : undefined;
}

// Every write restricts its file and folder; on Windows each restriction starts whoami and icacls,
// which take seconds on a CI runner.
const contractTimeoutMs = 30_000;

describe("file secret store", () => {
  it.each(
    secretStoreContract({
      create: async (entries) => {
        const created = store(await keysFolder());
        await Promise.all(
          Object.entries(entries).map(async ([name, value]) =>
            created.write(name, createSecret(value), signal()),
          ),
        );
        return created;
      },
    }),
  )(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
    contractTimeoutMs,
  );

  it(
    "keeps each entry as the text of its own file, read back trimmed",
    async () => {
      const folder = await keysFolder();
      await store(folder).write("privy-app-secret", createSecret("app-secret"), signal());
      expect(await readFile(join(folder, "privy-app-secret"), "utf8")).toBe("app-secret\n");
      await writeFile(join(folder, "privy-app-secret"), "  edited-secret \r\n");
      await expect(readText(store(folder), "privy-app-secret")).resolves.toBe("edited-secret");
    },
    contractTimeoutMs,
  );

  it.skipIf(process.platform === "win32")(
    "makes the folder and each file owner-only",
    async () => {
      const folder = await keysFolder();
      await store(folder).write("agent-key", createSecret("key-text"), signal());
      expect((await stat(folder)).mode & 0o777).toBe(0o700);
      expect((await stat(join(folder, "agent-key"))).mode & 0o777).toBe(0o600);
    },
    contractTimeoutMs,
  );

  it("refuses a name that would leave the folder before touching a file", async () => {
    const folder = await keysFolder();
    await expect(store(folder).read("../config.json5", signal())).rejects.toMatchObject({
      code: "platform.secret_name_invalid",
    });
  });
});
