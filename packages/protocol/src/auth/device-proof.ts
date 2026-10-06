/** What a console device signs to answer a `challenge`. */
export interface DeviceProofInput {
  /** The nonce of the engine's `challenge` frame. */
  readonly nonce: string;
  /** The console page's origin, such as `http://127.0.0.1:7456`. */
  readonly origin: string;
}

/**
 * The text a console device signs, as UTF-8, to prove it holds its key: a fixed label, the
 * challenge's nonce and the page's origin, one per line. The device sends the signature in
 * `prove`, and the engine verifies it over the same text with the origin it saw.
 */
export function deviceProofText(input: DeviceProofInput): string {
  return ["binference-device-v1", input.nonce, input.origin].join("\n");
}
