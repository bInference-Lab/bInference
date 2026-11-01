import { type AccountRef, accountRefSchema } from "@binference/chain";
import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { RescueReachRecord, RescueReachState } from "../install/rescue-record.js";
import { testAgent } from "../intents/test-intents.js";
import { roomedOut, walletRecipients } from "./wallet-recipients.js";

const account = (text: string): AccountRef => accountRefSchema.parse(text);
const otherAgent = idSchema("agt").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000009");
const rescue = account("fake:1:0x000000d9");
const rescueThere = account("fake:2:0x000000d9");
const rescueFar = account("fake:3:0x000000d9");
const nextRescue = account("fake:1:0x000000d8");
const nextThere = account("fake:2:0x000000d8");
const savedThere = account("fake:2:0x000000b1");
const savedHere = account("fake:1:0x000000a1");

const standing = (
  at: AccountRef,
  state: RescueReachState = "joined",
  agent = testAgent,
): RescueReachRecord => ({ agent, account: at, state });

const records = [standing(rescueThere), standing(rescueFar), standing(nextThere, "waiting")];
const reach = { records, most: 100 };
const wallet = (saved: readonly AccountRef[]) => ({ agent: testAgent, saved });

describe("whom a ceiling pays", () => {
  it("adds the rescue address after the saved ones where its agent's standing lists it", () => {
    expect(
      walletRecipients(wallet([savedHere, savedThere]), { rescues: [rescue], reach }),
    ).toStrictEqual([rescue, savedHere, savedThere, rescueThere]);
  });

  it("never adds it from another agent's standing, or one that leaves it out", () => {
    const others = { records: [standing(rescueThere, "joined", otherAgent)], most: 100 };
    const failed = {
      records: [standing(rescueThere, "code"), standing(nextThere, "room")],
      most: 100,
    };
    expect(
      walletRecipients(wallet([savedThere]), { rescues: [rescue], reach: others }),
    ).toStrictEqual([rescue, savedThere]);
    expect(
      walletRecipients(wallet([savedThere]), { rescues: [rescue, nextRescue], reach: failed }),
    ).toStrictEqual([rescue, nextRescue, savedThere]);
  });

  it("adds it beside an account being saved for the destination", () => {
    expect(
      walletRecipients(wallet([]), { rescues: [rescue], saving: savedThere, reach }),
    ).toStrictEqual([rescue, savedThere, rescueThere]);
  });

  it("lists both rescue addresses there while a new one waits, each only beside its own", () => {
    const saved = wallet([savedThere]);
    expect(walletRecipients(saved, { rescues: [rescue, nextRescue], reach })).toStrictEqual([
      rescue,
      nextRescue,
      savedThere,
      rescueThere,
      nextThere,
    ]);
    expect(walletRecipients(saved, { rescues: [nextRescue], reach })).toStrictEqual([
      nextRescue,
      savedThere,
      nextThere,
    ]);
  });

  it("never displaces a saved address, and names what a full chain leaves out", () => {
    const tight = { records, most: 2 };
    const payees = { rescues: [rescue, nextRescue], reach: tight };
    expect(walletRecipients(wallet([savedThere]), payees)).toStrictEqual([
      rescue,
      nextRescue,
      savedThere,
      rescueThere,
    ]);
    expect(roomedOut(wallet([savedThere]), payees)).toStrictEqual([nextThere]);
  });

  it("lists it once where the owner saved it for the destination too", () => {
    expect(walletRecipients(wallet([rescueThere]), { rescues: [rescue], reach })).toStrictEqual([
      rescue,
      rescueThere,
    ]);
  });
});
