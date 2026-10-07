import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecret, isErrorCode, type SecretStore } from "@binference/core";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { FilePermissions } from "../ports.js";
import { createPassphraseSecretStore } from "./passphrase-secret-store.js";

// The agent-key file of the keys spec, section 3, pinned. The key was derived with the openssl
// command line (scrypt, cost 131072) and checked against Node's scrypt; the plaintext is the
// signer's text form of the test key whose scalar is 1, which the signer's tests pin as well.
const pinnedFile = {
  format: "binference-agent-key",
  version: 1,
  kdf: "scrypt",
  kdfParams: {
    n: 131_072,
    r: 8,
    p: 1,
    dkLen: 32,
    salt: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
  },
  cipher: "aes-256-gcm",
  iv: "oKGio6Slpqeoqaqr",
  aad: "binference-agent-key-v1:ins_known",
  ciphertext:
    "S4BsAG5ZoQKa03Vi8yOW0ZZgvqXKVId8nBp92oHeBML8RowYGsVIii534dZ0Zt+bZXYGxpSC2ecN1kUFzAkctGJVK6yy" +
    "fmQcymbRHti+uvhrxTQ65UyITD1f1a7tsOEsUPUD6CC7EKf/gCKs9CxdIZ3Ar7+Al+T5B2Qsrppu0Y27WYCl6BRvpFue" +
    "A6ct28zahhH/FF7jcRLJSjakPe/TcREHrlTX/yhBpSl6cIKk8iCebrLbBOTh2Q==",
  tag: "iIld98NxUTlx7vbCGUQILQ==",
};
const pinnedText =
  "MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGh" +
  "RANCAARrF9Hy4SxCR/i85uVjpEDydwN9gS3rM6D0oTlF2JjClk/jQuL+Gn+bjufrSnwPnhYrzjNXazFezsu2QGg3v1H1";

const folders: string[] = [];

async function keysFolder(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bnf-"));
  folders.push(root);
  const folder = join(root, "keys");
  await mkdir(folder);
  return folder;
}

afterEach(async () => {
  await Promise.all(
    folders
      .splice(0)
      .map(async (folder) => rm(folder, { recursive: true, maxRetries: 10, retryDelay: 200 })),
  );
});

// The file's access list is the permission tests' subject, not this file's: no OS tool runs here.
const ownerOnly: FilePermissions = {
  restrictFolder: async () => undefined,
  restrictFile: async () => undefined,
};

const store = (folder: string, installId: string, scryptCost?: number): SecretStore =>
  createPassphraseSecretStore({
    folder,
    installId,
    passphrase: createSecret("correct horse battery staple"),
    permissions: ownerOnly,
    ...(scryptCost === undefined ? {} : { scryptCost }),
  });

const signal = (): AbortSignal => new AbortController().signal;

// What a read of the entry gives: its text, `not_found`, or the code it was refused with.
async function readOutcome(from: SecretStore): Promise<string> {
  try {
    const read = await from.read("agent-key", signal());
    return read.ok ? read.value.reveal() : read.error;
  } catch (error) {
    return error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : "thrown";
  }
}

// Reads each version of the file through its own keys folder. A folder each, never one path
// rewritten hundreds of times, which a virus scanner on Windows can hold open.
async function outcomesOf(versions: readonly Uint8Array[]): Promise<readonly string[]> {
  const root = await keysFolder();
  return Promise.all(
    versions.map(async (version, index) => {
      const folder = join(root, String(index));
      await mkdir(folder);
      await writeFile(join(folder, "agent-key.json"), version);
      return readOutcome(store(folder, "ins_1"));
    }),
  );
}

// An agent-key file the store writes, at a test cost, holding the pinned key text.
async function writtenFile(): Promise<Buffer> {
  const folder = await keysFolder();
  await store(folder, "ins_1", 1024).write("agent-key", createSecret(pinnedText), signal());
  return readFile(join(folder, "agent-key.json"));
}

const sealedFields = z.looseObject({
  kdfParams: z.looseObject({ salt: z.base64() }),
  iv: z.base64(),
  ciphertext: z.base64(),
  tag: z.base64(),
});

// Each version of the bytes with the lowest bit of one byte flipped, for every byte in turn.
function oneByteChanges(bytes: Uint8Array): readonly Buffer[] {
  return Array.from({ length: bytes.length }, (_, index) => {
    const changed = Buffer.from(bytes);
    changed.writeUInt8(changed.readUInt8(index) ^ 0x01, index);
    return changed;
  });
}

// The file with one byte of one binary field flipped, for every byte of the salt, the nonce, the
// ciphertext and the tag.
function binaryTampers(text: string): readonly Uint8Array[] {
  const file = sealedFields.parse(JSON.parse(text));
  const fields = {
    salt: file.kdfParams.salt,
    iv: file.iv,
    ciphertext: file.ciphertext,
    tag: file.tag,
  };
  return Object.entries(fields).flatMap(([field, value]) =>
    oneByteChanges(Buffer.from(value, "base64")).map((changed) => {
      const encoded = changed.toString("base64");
      const tampered =
        field === "salt"
          ? { ...file, kdfParams: { ...file.kdfParams, salt: encoded } }
          : { ...file, [field]: encoded };
      return Buffer.from(JSON.stringify(tampered));
    }),
  );
}

describe("the agent-key file", () => {
  it("opens the pinned file to the pinned agent key, at cost 131072", async () => {
    const folder = await keysFolder();
    await writeFile(join(folder, "agent-key.json"), JSON.stringify(pinnedFile, null, 2));

    await expect(readOutcome(store(folder, "ins_known"))).resolves.toBe(pinnedText);
  });

  it("fails decryption when any byte of the salt, nonce, ciphertext or tag changes", async () => {
    const versions = binaryTampers((await writtenFile()).toString("utf8"));

    const outcomes = await outcomesOf(versions);

    // The salt, the nonce, one ciphertext byte per character of the key text, and the tag.
    expect(versions).toHaveLength(32 + 12 + pinnedText.length + 16);
    expect(new Set(outcomes)).toStrictEqual(new Set(["platform.passphrase_rejected"]));
  });

  it("refuses the file with any one byte changed, and never opens it", async () => {
    const original = await writtenFile();

    const outcomes = await outcomesOf(oneByteChanges(original));

    expect(outcomes).toHaveLength(original.length);
    expect(outcomes.filter((outcome) => !isErrorCode(outcome))).toStrictEqual([]);
    expect(new Set(outcomes)).toStrictEqual(
      new Set(["platform.passphrase_rejected", "platform.secret_file_invalid"]),
    );
  });
});
