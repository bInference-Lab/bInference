import type { Result } from "@binference/core";
import { readFilePieces } from "@binference/platform";
import { backupDay } from "../attach/restore-guards-step.js";
import { parseHeader, splitHeader } from "./header-line.js";

/** Bytes that arrive in the given pieces, one after another. */
export async function* piecesOf(pieces: readonly Uint8Array[]): AsyncGenerator<Uint8Array> {
  await Promise.resolve();
  yield* pieces;
}

/** Every piece, in order. */
export async function listed(pieces: AsyncIterable<Uint8Array>): Promise<Uint8Array[]> {
  const all: Uint8Array[] = [];
  for await (const piece of pieces) {
    all.push(piece);
  }
  return all;
}

/** Every piece joined into one buffer. */
export async function joined(pieces: AsyncIterable<Uint8Array>): Promise<Buffer> {
  return Buffer.concat(await listed(pieces));
}

/** The value of a result a test expects to hold one. */
export function valueOf<Value, Problem extends string>(result: Result<Value, Problem>): Value {
  if (!result.ok) {
    throw new Error(`Expected a value, got ${result.error}.`);
  }
  return result.value;
}

/** A test owner key: its ECDH pair, and its public half as DER SubjectPublicKeyInfo in base64. */
export async function testOwnerKey(): Promise<{
  readonly pair: { readonly privateKey: CryptoKey; readonly publicKey: CryptoKey };
  readonly publicKey: string;
}> {
  const { subtle } = globalThis.crypto;
  const pair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, [
    "deriveBits",
  ]);
  const spki = await subtle.exportKey("spki", pair.publicKey);
  return { pair, publicKey: Buffer.from(spki).toString("base64") };
}

/** The day a person types to confirm restoring a backup file, from the time its header names. */
export async function dayOfBackup(file: string): Promise<string> {
  const split = valueOf(
    await splitHeader(readFilePieces(file, { signal: new AbortController().signal })),
  );
  await split.close();
  return backupDay(valueOf(parseHeader(split.line)).createdAt);
}
