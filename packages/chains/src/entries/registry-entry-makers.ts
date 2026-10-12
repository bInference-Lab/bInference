import type { ContractDefinition, TokenDefinition } from "@binference/chain";

/** A token as a chain file lists it: its symbol, name, decimals and address. */
type TokenRow = readonly [symbol: string, name: string, decimals: number, address: string];

/** Token rows, keyed by the source page that publishes them. */
type TokenRowsBySource = Readonly<Record<string, readonly TokenRow[]>>;

/** Contract addresses by name, keyed by the source page that publishes them. */
type AddressesBySource = Readonly<Record<string, Readonly<Record<string, string>>>>;

/**
 * What a chain file builds its registry entries with. Each entry is verified by a read on chain
 * (`control: "read"`) on `readOn`, the chain file's own day when left out, and names its source.
 */
export interface RegistryEntryMakers {
  readonly createTokens: (rowsBySource: TokenRowsBySource, readOn?: string) => TokenDefinition[];
  readonly createContracts: (
    venue: string,
    sources: AddressesBySource,
    readOn?: string,
  ) => ContractDefinition[];
}

/** The makers of a chain file whose addresses were read on chain on `checkedOn`. */
export function registryEntryMakers(checkedOn: string): RegistryEntryMakers {
  return {
    createTokens: (rowsBySource, readOn = checkedOn) =>
      Object.entries(rowsBySource).flatMap(([source, rows]) =>
        rows.map(([symbol, name, decimals, address]): TokenDefinition => ({
          symbol,
          name,
          decimals,
          address,
          verification: { source, checkedOn: readOn, control: "read" },
        })),
      ),
    createContracts: (venue, sources, readOn = checkedOn) =>
      Object.entries(sources).flatMap(([source, addresses]) =>
        Object.entries(addresses).map(([name, address]): ContractDefinition => ({
          venue,
          name,
          address,
          verification: { source, checkedOn: readOn, control: "read" },
        })),
      ),
  };
}
