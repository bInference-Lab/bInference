import { err, ok, type Result } from "@binference/core";
import type { ExportRecipient } from "../contracts/wallet-exporter-contract.js";
import type { WalletExporter } from "../install/ports.js";
import type { ExportRefusal, SealedKey } from "../install/wallet-export.js";
import { fakeOwnerKeyCode } from "./fake-ceiling-editor.js";
import { memoryCall } from "./memory-call.js";

/** Seals a key's text to a recipient key, or answers undefined for a key that is none. */
export type FakeSeal = (recipientPublicKey: string, text: string) => Promise<SealedKey | undefined>;

/** Where the fake exporter's keys come from, and how it seals them. */
export interface FakeWalletExporterOptions {
  /** Each wallet's private key text, by the id custody gives the wallet. */
  readonly keys: ReadonlyMap<string, string>;
  /** Seals a key; a seal of {@link createFakeSeal} when absent, which is no encryption. */
  readonly seal?: FakeSeal;
}

// A P-256 public key as DER SubjectPublicKeyInfo is 91 bytes.
const spkiBytes = 91;

/**
 * A seal as a fake does it, with no encryption: the ciphertext names the recipient key beside the
 * text, and each seal gets an encapsulated key of its own. A recipient key that does not decode to
 * 91 bytes is none.
 */
export function createFakeSeal(): FakeSeal {
  const count = { sealed: 0 };
  return async (recipientPublicKey, text) => {
    if (Buffer.from(recipientPublicKey, "base64").length !== spkiBytes) {
      return Promise.resolve(undefined);
    }
    count.sealed += 1;
    const encapsulatedKey = Buffer.from(`fake-enc-${String(count.sealed)}`).toString("base64");
    const ciphertext = Buffer.from(`${recipientPublicKey}|${text}`).toString("base64");
    return Promise.resolve({ ciphertext, encapsulatedKey });
  };
}

/** A recipient for {@link createFakeSeal}: a public key that opens only what names it. */
export async function fakeRecipient(n: number): Promise<ExportRecipient> {
  const publicKey = Buffer.alloc(spkiBytes, n % 256).toString("base64");
  return Promise.resolve({
    publicKey,
    open: async ({ ciphertext }) => {
      const [named = "", text = ""] = Buffer.from(ciphertext, "base64").toString().split("|");
      return named === publicKey
        ? Promise.resolve(text)
        : Promise.reject(new Error("The key was sealed to another recipient."));
    },
  });
}

/**
 * Creates a {@link WalletExporter} in memory, owned by the fake owner key the fake ceiling editor
 * takes: it exports the keys it holds, sealed by `seal`.
 */
export function createFakeWalletExporter(options: FakeWalletExporterOptions): WalletExporter {
  const seal = options.seal ?? createFakeSeal();
  return {
    exportSealed: async (request, call) => {
      const key = await memoryCall(call, () => options.keys.get(request.wallet));
      if (request.ownerKey.reveal() !== fakeOwnerKeyCode) {
        return err("bad_owner_key");
      }
      if (key === undefined) {
        return err("not_found");
      }
      const done = await seal(request.recipientPublicKey, key);
      const answer: Result<SealedKey, ExportRefusal> =
        done === undefined ? err("bad_recipient_key") : ok(done);
      return answer;
    },
  };
}
