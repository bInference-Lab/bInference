import { accountRefSchema, type AccountRef } from "@binference/plugin-sdk";

/**
 * The wallet the recorded builds pay: the last 20 bytes of the Keccak-256 hash of the text
 * `binference kyberswap fork wallet`, so no one holds its key. The fork tests use it too.
 */
export const recordedWallet: AccountRef = accountRefSchema.parse(
  "eip155:56:0x8B357176C76fbbfdF51E196C9Bf6843642Aca70e",
);

/** The deadline both recorded builds carry, in Unix seconds: 2026-10-07 13:07:37 UTC. */
export const recordedDeadlineSec = 1_791_378_457;
