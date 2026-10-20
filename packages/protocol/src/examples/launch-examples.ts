import type { LaunchDraftOperationShapes } from "../operations/launch-draft-operations.schema.js";
import type { LaunchpadOperationShapes } from "../operations/launchpad-operations.schema.js";
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
