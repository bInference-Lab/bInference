import { err, ok, type Result } from "@binference/core";
import type { AddressCodec } from "../addresses/ports.js";
import { isFakeAddress } from "./fake-draft.js";

const length = 4;

function parse(text: string): Result<string, "malformed_address"> {
  return isFakeAddress(text) ? ok(text.toLowerCase()) : err("malformed_address");
}

/**
 * The fake family's address codec, for tests: namespace `fake`, addresses of 8 hex digits after
 * `0x`, canonical in lowercase, whose recipient bytes are those 4.
 */
export function createFakeAddressCodec(): AddressCodec {
  return {
    namespace: "fake",
    recipientLength: length,
    parse,
    toBytes(text) {
      const parsed = parse(text);
      return parsed.ok ? ok(Uint8Array.from(Buffer.from(parsed.value.slice(2), "hex"))) : parsed;
    },
    fromBytes(bytes) {
      return bytes.length === length
        ? ok(`0x${Buffer.from(bytes).toString("hex")}`)
        : err("malformed_address");
    },
  };
}
