import { z } from "zod";

/** The scrypt parameters a sealed secret was made with. */
interface ScryptParams {
  /** The cost N, a power of two: 131072 for a new secret. */
  readonly n: number;
  readonly r: 8;
  readonly p: 1;
  readonly dkLen: 32;
  /** 32 random bytes, base64. */
  readonly salt: string;
}

/**
 * A secret sealed with a passphrase: scrypt derives an AES-256-GCM key from the passphrase, and the
 * associated data binds the file to its entry and install. The agent-key file of the keys spec,
 * section 3, is one of these.
 */
export interface SealedSecret {
  /** `binference-<entry name>`. */
  readonly format: string;
  readonly version: 1;
  readonly kdf: "scrypt";
  readonly kdfParams: ScryptParams;
  readonly cipher: "aes-256-gcm";
  /** 12 random bytes, base64. */
  readonly iv: string;
  /** `binference-<entry name>-v1:<install id>`. */
  readonly aad: string;
  readonly ciphertext: string;
  /** 16 bytes, base64. */
  readonly tag: string;
}

function isBase64(text: string): boolean {
  return Buffer.from(text, "base64").toString("base64") === text;
}

const base64Of = (bytes: number) =>
  z.string().refine((text) => isBase64(text) && Buffer.from(text, "base64").length === bytes, {
    message: `must be ${String(bytes)} bytes in base64`,
  });

// A cost above 2^20 would make a read hold more than 1 GiB, so a file cannot ask for it.
const sealedSecretSchema: z.ZodType<SealedSecret> = z.strictObject({
  format: z.string().min(1),
  version: z.literal(1),
  kdf: z.literal("scrypt"),
  kdfParams: z.strictObject({
    n: z
      .int()
      .min(1024)
      .max(1_048_576)
      .refine((n) => (n & (n - 1)) === 0, { message: "must be a power of two" }),
    r: z.literal(8),
    p: z.literal(1),
    dkLen: z.literal(32),
    salt: base64Of(32),
  }),
  cipher: z.literal("aes-256-gcm"),
  iv: base64Of(12),
  aad: z.string().min(1),
  ciphertext: z.string().refine(isBase64, { message: "must be base64" }),
  tag: base64Of(16),
});

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Reads a sealed secret file. Text that is not JSON, or JSON of another shape, is `undefined`; so is
 * a scrypt cost outside 1024 to 1048576 or not a power of two.
 */
export function parseSealedSecret(text: string): SealedSecret | undefined {
  const parsed = sealedSecretSchema.safeParse(parseJson(text));
  return parsed.success ? parsed.data : undefined;
}
