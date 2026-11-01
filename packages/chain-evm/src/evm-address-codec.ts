import type { AddressCodec } from "@binference/chain";
import { err, ok } from "@binference/core";
import { bytesToHex, hexToBytes } from "viem";
import { parseEvmAddress } from "./evm-address.js";
import { evmNamespace } from "./evm-ids.js";

const length = 20;

/**
 * The EVM family's address codec (decision 0298): an address checked by its EIP-55 checksum, as
 * `parseEvmAddress` checks it, whose recipient bytes are its 20.
 */
export function createEvmAddressCodec(): AddressCodec {
  return {
    namespace: evmNamespace,
    recipientLength: length,
    parse: parseEvmAddress,
    toBytes(text) {
      const parsed = parseEvmAddress(text);
      return parsed.ok ? ok(hexToBytes(parsed.value)) : parsed;
    },
    fromBytes(bytes) {
      return bytes.length === length
        ? parseEvmAddress(bytesToHex(Uint8Array.from(bytes)))
        : err("malformed_address");
    },
  };
}
