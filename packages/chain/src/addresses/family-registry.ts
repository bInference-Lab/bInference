import { BinferenceError, err, ok, type Result } from "@binference/core";
import { type ChainRef, chainRefParts } from "../caip/chain-ref.js";
import type { AddressCodec } from "./ports.js";

/**
 * The chain family registry (decision 0298): the address codec of each CAIP-2 namespace, so the
 * address book, the ceiling's recipient bytes and the cards take a family from an account's
 * namespace and never from a chain's name.
 */
export interface FamilyRegistry {
  /** The codecs it holds, one per namespace. */
  readonly codecs: readonly AddressCodec[];
  /** The codec of the chain's namespace; `unknown_family` for a namespace no family serves. */
  codecOf(chain: ChainRef): Result<AddressCodec, "unknown_family">;
}

/**
 * Creates the {@link FamilyRegistry} from each family's codec. Two codecs of one namespace are a
 * fault of the composition: the registry refuses to start.
 */
export function createFamilyRegistry(codecs: readonly AddressCodec[]): FamilyRegistry {
  const byNamespace = new Map(codecs.map((codec) => [codec.namespace, codec]));
  if (byNamespace.size !== codecs.length) {
    throw new BinferenceError({
      code: "chain.duplicate_family",
      message: "Two address codecs serve one CAIP-2 namespace.",
    });
  }
  return {
    codecs,
    codecOf(chain) {
      const codec = byNamespace.get(chainRefParts(chain).namespace);
      return codec === undefined ? err("unknown_family") : ok(codec);
    },
  };
}
