import type { BridgeOperationShapes } from "../operations/bridge-operations.schema.js";
import type { LaunchDraftOperationShapes } from "../operations/launch-draft-operations.schema.js";
import type { LaunchpadOperationShapes } from "../operations/launchpad-operations.schema.js";
import type { StakingOperationShapes } from "../operations/staking-operations.schema.js";
import { at, ids, nativeAmount, refs, type WireExample } from "./wire-values.js";

/** An example call of the launchpad read: one launchpad that uploads, one that takes a link. */
export const launchpadExamples: { readonly [N in keyof LaunchpadOperationShapes]: WireExample } = {
  "launchpad/list": {
    args: { chain: refs.chain },
    result: {
      items: [
        {
          venue: "fake-curve",
          picture: { place: "upload", mostBytes: 5_242_880 },
          settings: [{ name: "taxBps", type: "bps", max: 1_000, default: 100 }],
        },
        {
          venue: "fake-linked",
          picture: { place: "link" },
          settings: [{ name: "pictureLink", type: "link" }],
        },
      ],
    },
  },
};

/** An example of the agent's launch draft, with the owner's photo as its picture. */
export const launchDraftExamples: {
  readonly [N in keyof LaunchDraftOperationShapes]: WireExample;
} = {
  "launch/draft": {
    args: {
      agent: ids.agent,
      session: ids.session,
      turn: ids.turn,
      launch: {
        reason: "You asked for a cat token",
        venue: "fake-curve",
        name: "Fork Cat",
        symbol: "FCAT",
        pairWith: refs.native,
        firstBuy: nativeAmount,
      },
      photo: { message: ids.message, image: "tg:AgACAgIAAxkBAAIB" },
    },
    result: { draft: "c2hvd24tb25jZS1h", expiresAt: at + 600_000 },
  },
};

/** An example call of the staking read: one validator, and the agent's stake with it on paper. */
export const stakingExamples: { readonly [N in keyof StakingOperationShapes]: WireExample } = {
  "staking/options": {
    args: { chain: refs.chain, agent: ids.agent, venue: "fake-staking" },
    result: {
      items: [
        {
          venue: "fake-staking",
          validator: refs.account,
          name: "Validator",
          commissionBps: 500,
          aprBps: 210,
          jailed: false,
          unbondingSeconds: 604_800,
          minAmount: { asset: refs.native, base: "1000000000000000000" },
        },
      ],
      positions: [
        {
          wallet: ids.wallet,
          venue: "fake-staking",
          validator: refs.account,
          staked: { asset: refs.token, base: "1000000" },
          stakedValue: { asset: refs.native, base: "1050000000000000000" },
          unbonding: [{ amount: nativeAmount, readyAt: at }],
          claimable: { asset: refs.native, base: "0" },
          paper: true,
        },
      ],
      assets: {},
    },
  },
};

/** An example call of the bridge read: one route of the example token to another chain. */
export const bridgeExamples: { readonly [N in keyof BridgeOperationShapes]: WireExample } = {
  "bridge/quote": {
    args: {
      agent: ids.agent,
      amount: { asset: refs.token, base: "20000000" },
      toChain: "fake:2",
      to: { entry: ids.entry },
    },
    result: {
      items: [
        {
          venue: "fake-bridge",
          toChain: "fake:2",
          sentAsset: refs.token,
          deliveredAsset: "fake:2/token:0x0000000b",
          amountIn: { asset: refs.token, base: "20000000" },
          expectedOut: { asset: "fake:2/token:0x0000000b", base: "19970000" },
          minOut: { asset: "fake:2/token:0x0000000b", base: "19970000" },
          fees: [{ kind: "relayer", amount: { asset: refs.token, base: "30000" } }],
          etaSeconds: 4,
          quotedAt: at,
          expiresAt: at + 60_000,
        },
      ],
      assets: {},
    },
  },
};
