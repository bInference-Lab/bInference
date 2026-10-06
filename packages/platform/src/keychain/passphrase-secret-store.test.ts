import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecret, type Secret } from "@binference/core";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { secretStoreContract } from "../contracts/secret-store-contract.js";
import { createPlatform } from "../create-platform.js";
import type { SecretStore } from "../ports.js";
import { createPassphraseSecretStore } from "./passphrase-secret-store.js";

const folders: string[] = [];

async function keysFolder(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bnf-"));
  folders.push(root);
  return join(root, "keys");
}

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => rm(folder, { recursive: true })));
});

interface StoreOptions {
  readonly folder: string;
  readonly installId?: string;
  readonly passphrase?: Secret;
  readonly scryptCost?: number;
}

function store(options: StoreOptions): SecretStore {
  return createPassphraseSecretStore({
    folder: options.folder,
    installId: options.installId ?? "ins_1",
    passphrase: options.passphrase ?? createSecret("correct horse battery staple"),
    permissions: createPlatform().permissions,
    scryptCost: options.scryptCost ?? 1024,
  });
}

const signal = (): AbortSignal => new AbortController().signal;

async function writtenStore(options: StoreOptions): Promise<SecretStore> {
  const written = store(options);
  await written.write("agent-key", createSecret("p256:agent"), signal());
  return written;
}

const sealedFile = z.looseObject({ ciphertext: z.string(), kdfParams: z.looseObject({}) });

// Every field of the agent-key file in the keys spec, section 3, and no other.
const agentKeyFile = z.strictObject({
  format: z.string(),
  version: z.number(),
  kdf: z.string(),
  kdfParams: z.strictObject({
    n: z.number(),
    r: z.number(),
    p: z.number(),
    dkLen: z.number(),
    salt: z.base64(),
  }),
  cipher: z.string(),
  iv: z.base64(),
  aad: z.string(),
  ciphertext: z.base64(),
  tag: z.base64(),
});

describe("passphrase secret store", () => {
  it.each(
    secretStoreContract({
      create: async (entries) => {
        const created = store({ folder: await keysFolder() });
        await Promise.all(
          Object.entries(entries).map(async ([name, value]) =>
            created.write(name, createSecret(value), signal()),
          ),
        );
        return created;
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("writes the agent-key file of the keys spec, with scrypt at cost 131072", async () => {
    const folder = await keysFolder();
    const written = store({ folder, scryptCost: 131_072 });
    await written.write("agent-key", createSecret("p256:agent"), signal());

    const text = await readFile(join(folder, "agent-key.json"), "utf8");
    const file = agentKeyFile.parse(JSON.parse(text));

    expect(file).toStrictEqual({
      format: "binference-agent-key",
      version: 1,
      kdf: "scrypt",
      kdfParams: { n: 131_072, r: 8, p: 1, dkLen: 32, salt: file.kdfParams.salt },
      cipher: "aes-256-gcm",
      iv: file.iv,
      aad: "binference-agent-key-v1:ins_1",
      ciphertext: file.ciphertext,
      tag: file.tag,
    });
    expect(
      [file.kdfParams.salt, file.iv, file.tag].map((field) => Buffer.from(field, "base64").length),
    ).toStrictEqual([32, 12, 16]);
    expect(text).not.toContain("p256:agent");
    await expect(written.read("agent-key", signal())).resolves.toMatchObject({ ok: true });
  });

  it("refuses a wrong passphrase", async () => {
    const folder = await keysFolder();
    await writtenStore({ folder });

    await expect(
      store({ folder, passphrase: createSecret("wrong horse") }).read("agent-key", signal()),
    ).rejects.toMatchObject({ code: "platform.passphrase_rejected" });
  });

  it("refuses a file with one changed byte", async () => {
    const folder = await keysFolder();
    const written = await writtenStore({ folder });
    const path = join(folder, "agent-key.json");
    const file = sealedFile.parse(JSON.parse(await readFile(path, "utf8")));
    const bytes = Buffer.from(file.ciphertext, "base64");
    bytes.writeUInt8(bytes.readUInt8(0) ^ 1, 0);
    await writeFile(path, JSON.stringify({ ...file, ciphertext: bytes.toString("base64") }));

    await expect(written.read("agent-key", signal())).rejects.toMatchObject({
      code: "platform.passphrase_rejected",
    });
  });

  it("refuses a file copied from another install or renamed from another entry", async () => {
    const folder = await keysFolder();
    await writtenStore({ folder });
    await copyFile(join(folder, "agent-key.json"), join(folder, "privy-app-secret.json"));
    const invalid = { code: "platform.secret_file_invalid" };

    await expect(
      store({ folder, installId: "ins_2" }).read("agent-key", signal()),
    ).rejects.toMatchObject(invalid);
    await expect(store({ folder }).read("privy-app-secret", signal())).rejects.toMatchObject(
      invalid,
    );
  });

  it("refuses a file that is no sealed secret, or asks for more scrypt memory than allowed", async () => {
    const folder = await keysFolder();
    const written = await writtenStore({ folder });
    const path = join(folder, "agent-key.json");
    const file = sealedFile.parse(JSON.parse(await readFile(path, "utf8")));
    const invalid = { code: "platform.secret_file_invalid" };

    await writeFile(
      path,
      JSON.stringify({ ...file, kdfParams: { ...file.kdfParams, n: 2 ** 21 } }),
    );
    await expect(written.read("agent-key", signal())).rejects.toMatchObject(invalid);
    await writeFile(path, "not json");
    await expect(written.read("agent-key", signal())).rejects.toMatchObject(invalid);
  });

  it("opens a passphrase typed in another Unicode form", async () => {
    const folder = await keysFolder();
    await writtenStore({ folder, passphrase: createSecret("café au lait") });

    await expect(
      store({ folder, passphrase: createSecret("café au lait") }).read("agent-key", signal()),
    ).resolves.toMatchObject({ ok: true });
  });

  it("refuses an empty passphrase at once", () => {
    expect(() => store({ folder: "keys", passphrase: createSecret("") })).toThrow(
      expect.objectContaining({ code: "platform.passphrase_empty" }),
    );
  });

  it("fails with a code when an entry cannot be removed", async () => {
    const folder = await keysFolder();
    await mkdir(join(folder, "agent-key.json"), { recursive: true });

    await expect(store({ folder }).delete("agent-key", signal())).rejects.toMatchObject({
      code: "platform.file_write_failed",
    });
  });
});

describe.skipIf(process.platform === "win32")("passphrase secret store on macOS and Linux", () => {
  it("keeps the keys folder and its files owner-only", async () => {
    const folder = await keysFolder();
    await writtenStore({ folder });

    expect((await stat(folder)).mode & 0o777).toBe(0o700);
    expect((await stat(join(folder, "agent-key.json"))).mode & 0o777).toBe(0o600);
  });
});
