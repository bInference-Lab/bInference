import {
  type AccountRef,
  accountRefSchema,
  type AssetRef,
  assetRefSchema,
  type LaunchLog,
  type ReadAnswer,
} from "@binference/plugin-sdk";

// A launch on Genius.fun's m4.2 stack against the GENIUS token, through its router with a first
// buy: the logs of the events the venue declares for the launch feed, recorded from 48 Club's
// public node on 2026-10-19, and the answers of BNB Chain's public node to the launch's curve and
// token reads at block 128625623.

const account = (address: string): AccountRef => accountRefSchema.parse(`eip155:56:${address}`);

/** The token the recorded launch created, its curve, and its creator. */
export const recordedLaunch: {
  readonly token: AssetRef;
  readonly curve: AccountRef;
  readonly creator: AccountRef;
} = {
  token: assetRefSchema.parse("eip155:56/erc20:0xA7FBB40DE1D29c3bA95233db0378D90f25618B87"),
  curve: account("0x3babdc78bD72e6A02F0739A26201e859dD750A99"),
  creator: account("0xF3A57FcFcCb39DA893ae1E1902e90eC18A4e5c04"),
};

/** 0xad705b9138d04829f10a7aa3d81f2412d412854501e7b52cc5f33c5c6810185d, block 128579557. */
export const geniusLaunchLogs: readonly LaunchLog[] = [
  {
    emitter: account("0x3babdc78bD72e6A02F0739A26201e859dD750A99"),
    topics: [
      "0xe4b7e48fbd47c2f602bacadee76ad33b16542ddb4997cfc0de04c311adcfa8c7",
      "0x000000000000000000000000f3a57fcfccb39da893ae1e1902e90ec18a4e5c04",
    ],
    data: "0x",
    index: 5,
  },
  {
    emitter: account("0x37eE8AeE29C5efd3C1A7edA6dF3F510779928a37"),
    topics: [
      "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607",
      "0x000000000000000000000000a7fbb40de1d29c3ba95233db0378d90f25618b87",
      "0x0000000000000000000000003babdc78bd72e6a02f0739a26201e859dd750a99",
      "0x000000000000000000000000f3a57fcfccb39da893ae1e1902e90ec18a4e5c04",
    ],
    data: "0x0000000000000000000000001f12b85aac097e43aa1555b2881e98a51090e9a6000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000065a4da25d3016c00000",
    index: 6,
  },
  {
    emitter: account("0x3babdc78bD72e6A02F0739A26201e859dD750A99"),
    topics: [
      "0xe4b7e48fbd47c2f602bacadee76ad33b16542ddb4997cfc0de04c311adcfa8c7",
      "0x000000000000000000000000f3a57fcfccb39da893ae1e1902e90ec18a4e5c04",
    ],
    data: "0x",
    index: 7,
  },
];

/**
 * The curve's `creatorTaxBps`, `snipeTaxStartBps`, `launchSupply`, `reservedTokens`,
 * `sellableTokens` and `graduated`, then the token's `symbol` and `name`.
 */
export const recordedLaunchAnswers: readonly ReadAnswer[] = [
  "0x0000000000000000000000000000000000000000000000000000000000000000",
  "0x00000000000000000000000000000000000000000000000000000000000026ac",
  "0x0000000000000000000000000000000000000000033b2e3c9fd0803ce8000000",
  "0x000000000000000000000000000000000000000000ec565a76cddb7f1db6db6d",
  "0x0000000000000000000000000000000000000000023336f0f3613d2f8490c1f0",
  "0x0000000000000000000000000000000000000000000000000000000000000000",
  "0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000667414c5048410000000000000000000000000000000000000000000000000000",
  "0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000c47454e49555320414c5048410000000000000000000000000000000000000000",
];
