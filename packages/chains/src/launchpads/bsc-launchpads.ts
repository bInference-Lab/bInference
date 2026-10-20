import type { ContractDefinition } from "@binference/chain";
import { registryEntryMakers } from "../entries/registry-entry-makers.js";

// The launchpads' contracts on BSC, each read on chain as the chain file's own entries are: on the
// chain file's day unless a group says otherwise.
const { createContracts } = registryEntryMakers("2026-10-06");

const fourmeme = createContracts("fourmeme", {
  "https://github.com/four-meme-community/fourmeme-docs/blob/main/docs/integration-guide.md": {
    "token-manager-v1": "0xEC4549caDcE5DA21Df6E6422d448034B5233bFbC",
    "token-manager-2": "0x5c952063c7fc8610FFDB798152D69F0B9550762b",
    "token-manager-helper-3": "0xF251F83e40a78868FcfA3FA4599Dad6494E46034",
  },
  "https://github.com/four-meme-community/four-meme-ai/blob/main/skills/four-meme-integration/references/contract-addresses.md":
    { "agent-identifier": "0x09B44A633de9F9EBF6FB9Bdd5b5629d3DD2cef13" },
});

// The Portal is an EIP-1967 proxy under a ProxyAdmin with an owner key, so a curve trade is always
// simulated before it is signed. Read again on 2026-10-12: its verified code reports v5.24.0.
const flap = createContracts("flap", {
  "https://docs.flap.sh/flap/developers/deployed-contract-addresses": {
    portal: "0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0",
    "vault-portal": "0x90497450f2a706f1951b5bdda52B4E5d16f34C06",
    "tax-token-helper": "0x53841c73217735F37BC1775538b03b23feFD8346",
    "tax-token-v3-implementation": "0x024f18294970B5c76c0691b87f138A0317156422",
    "standard-token-v3-implementation": "0x88881b6f03090462a969eC7f48385744Eeb63333",
    "standard-token-implementation": "0x8B4329947e34B6d56D71A3385caC122BaDe7d78D",
  },
});

// Genius.fun's two live stacks, as genius.fun's own contract list names them: m4.2 launches now and
// m4.1 still takes launches. Each launch gets a curve of its own, which only its stack's factory
// names (`getLaunchedToken`). Neither factory nor hook is a proxy; a 2-of-3 Safe owns them all.
// Each factory's `memeHook()` is its stack's hook, each hook's `factory()` its stack's factory, and
// the code of each matches the code hash the list gives. Read a week after the others.
const geniusfun = createContracts(
  "geniusfun",
  {
    "https://genius.fun/api/launchpad/v1/contracts": {
      "factory-m4-2": "0x37eE8AeE29C5efd3C1A7edA6dF3F510779928a37",
      "hook-m4-2": "0x8E6f8eBbD62B60085B703C40B460daE802eDC51b",
      "factory-m4-1": "0x78EAE9537C0ef90DFe9B7ae964682Fe8138afe31",
      "hook-m4-1": "0xFf17F41c5Efd6CCe944Af0912F300097D62df5c9",
    },
  },
  "2026-10-14",
);

/** The contracts of the launchpads binference trades and launches on, on BSC. */
export const bscLaunchpadContracts: readonly ContractDefinition[] = [
  ...fourmeme,
  ...flap,
  ...geniusfun,
];
