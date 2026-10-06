import { Buffer } from "node:buffer";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { BinferenceError } from "@binference/core";
import type { FrameStream } from "./frame-stream.js";

const nonceBytes = 32;

// Each side proves it holds the key with an HMAC over both fresh nonces, so neither proof can be
// replayed or reflected, and the key never crosses the connection.
function proof(key: Uint8Array, side: "client" | "server", nonces: readonly Buffer[]): Buffer {
  const mac = createHmac("sha256", key).update(`binference ipc ${side}`);
  nonces.forEach((nonce) => mac.update(nonce));
  return mac.digest();
}

function unauthenticated(): BinferenceError {
  return new BinferenceError({
    code: "platform.ipc_unauthenticated",
    message: "The IPC peer does not hold this endpoint's key.",
  });
}

function check(received: Buffer, expected: Buffer): void {
  if (received.byteLength !== expected.byteLength || !timingSafeEqual(received, expected)) {
    throw unauthenticated();
  }
}

/**
 * The listener's half of the handshake: it answers the client's nonce with its proof and its own
 * nonce, then checks the client's proof. Throws `platform.ipc_unauthenticated` on a wrong proof.
 */
export async function proveServer(
  stream: FrameStream,
  key: Uint8Array,
  signal: AbortSignal,
): Promise<void> {
  const clientNonce = await stream.read(signal);
  if (clientNonce.byteLength !== nonceBytes) {
    throw unauthenticated();
  }
  const serverNonce = randomBytes(nonceBytes);
  const serverProof = proof(key, "server", [clientNonce, serverNonce]);
  await stream.write(Buffer.concat([serverNonce, serverProof]), signal);
  check(await stream.read(signal), proof(key, "client", [serverNonce, clientNonce]));
}

/**
 * The connecting half of the handshake: it checks the listener's proof before it proves itself,
 * so a process squatting on the address learns nothing. Throws `platform.ipc_unauthenticated`.
 */
export async function proveClient(
  stream: FrameStream,
  key: Uint8Array,
  signal: AbortSignal,
): Promise<void> {
  const clientNonce = randomBytes(nonceBytes);
  await stream.write(clientNonce, signal);
  const answer = await stream.read(signal);
  const serverNonce = answer.subarray(0, nonceBytes);
  check(answer.subarray(nonceBytes), proof(key, "server", [clientNonce, serverNonce]));
  await stream.write(proof(key, "client", [serverNonce, clientNonce]), signal);
}
