/** What a console device signs to answer a `challenge`. */
export interface DeviceProofInput {
  /** The connection the `challenge` frame named, such as `con_...`. */
  readonly connection: string;
  /** The device the `open` frame named, such as `dev_...`. */
  readonly device: string;
  /** The nonce of the engine's `challenge` frame. */
  readonly nonce: string;
  /** The console page's origin, such as `http://127.0.0.1:7456`. */
  readonly origin: string;
}

/**
 * The text a console device signs, as UTF-8, to prove it holds its key: a fixed label, then the
 * connection, the device, the challenge's nonce and the page's origin, one per line, so a proof
 * holds for one connection of one device on one origin. The device sends the signature in
 * `prove`, and the engine verifies it over the same text with the connection, device and origin
 * it knows.
 */
export function deviceProofText(input: DeviceProofInput): string {
  return ["binference-device-v2", input.connection, input.device, input.nonce, input.origin].join(
    "\n",
  );
}
