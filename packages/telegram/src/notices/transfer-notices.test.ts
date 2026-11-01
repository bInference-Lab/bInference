import { describe, expect, it } from "vitest";
import { base58Recipient } from "../testing/transfer-card-fixtures.js";
import { ownerId } from "../testing/update-fixtures.js";
import { sentNoticeTable } from "./notice-table-fixtures.js";
import { transferNoticeVariants } from "./transfer-notice-variants.js";

const done = String.fromCodePoint(0x2705);
const warning = String.fromCodePoint(0x26a0, 0xfe0f);
const lapsed = `${warning} Your bridge to Base was not sent before its confirmation ran out:`;
const notPaid = "Bridges from main's wallets do not pay your rescue address 0x9F3c…41aB on";
const sendTo = `${warning} A send to alice.bnb was not signed:`;
const sendAgain = "Nothing was sent. Check the name, then propose the send again.";

// Every other form of the bridge and send notices, as the owner reads it in English.
const expected: Readonly<Record<string, string>> = {
  "notice.bridgeArrived base58": `${done} Your late bridge to Solana arrived: ${base58Recipient} received 19.96 FAKE`,
  "notice.bridgeLapsed rescue": `${lapsed} your rescue address changed or gained code since its card, so check it, then propose it again. Nothing was signed.`,
  "notice.bridgeLapsed policy": `${lapsed} your limits or address book no longer allow it, so check them, then propose it again. Nothing was signed.`,
  "notice.bridgeLapsed other": `${lapsed} binference could not check it again, so propose it again. Nothing was signed.`,
  "notice.rescueBridged now":
    "Bridges from main's wallets may now pay your rescue address 0x9F3c…41aB on Base, Arbitrum: it holds no code there or on its own chain, so it is most likely a plain wallet with the same key there.",
  "notice.rescueNotBridged kind": `${notPaid} Solana: a bridge never pays the rescue address on a chain whose addresses are of another kind. To bridge there, save an address you control on Solana in the address book with your owner key.`,
  "notice.rescueNotBridged room": `${notPaid} Base: the ceiling lists the most addresses it holds there. To make room, remove an address saved for Base; binference adds the rescue address at the next change of the ceilings.`,
  "notice.rescueNotBridged other": `${notPaid} Base: binference could not read its code there. binference reads it again at the next change of the ceilings.`,
  "notice.nameMoved none": `${sendTo} the name now points to no address. ${sendAgain}`,
  "notice.nameMoved sameAddress": `${sendTo} the name still points to 0x71C7…976F, but that address changed kind since its card. ${sendAgain}`,
};

describe("every other form of the bridge and send notices, in English", () => {
  it("sends each form to the owner's chat as the spec words it", async () => {
    const sent = await sentNoticeTable("en", transferNoticeVariants);
    expect(sent.chats).toStrictEqual([ownerId]);
    expect(sent.texts).toStrictEqual(expected);
  });
});
