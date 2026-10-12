import { noticeTable } from "@binference/engine/testing";
import { messages } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import { ownerId } from "../testing/update-fixtures.js";
import { sentNoticeTable } from "./notice-table-fixtures.js";

const paper = String.fromCodePoint(0x1f9ea);
const done = String.fromCodePoint(0x2705);
const warning = String.fromCodePoint(0x26a0, 0xfe0f);
const red = String.fromCodePoint(0x1f534);
const green = String.fromCodePoint(0x1f7e2);

// Every notice of spec 4, section 4, with sections 4.2 and 4.3, as the owner reads it in English.
const expected: Readonly<Record<string, string>> = {
  "notice.fill": `${paper} ${done} Take-profit filled: sold 1.65 FAKE for $12.40 at $0.0000075`,
  "notice.skipped": `${warning} Stop-loss skipped: the wallet holds too little of this token. The order stays active.`,
  "notice.lowGas": `${warning} Main has 0.001 FAKE left for network fees. Add BNB.`,
  "notice.orderExpiring": "Limit order ends Oct 11, 2026, 09:30:00",
  "notice.frozen": `${red} main is frozen from Telegram. Unfreeze in the CLI, the console or the Mini App.`,
  "notice.unfrozen": `${green} main is unfrozen from the console.`,
  "notice.rescue": `${red} Rescue confirmed: moving everything to 0x9F3c…41aB`,
  "notice.newDevice": "A new console device was paired: Laptop",
  "notice.signInsLocked": `${warning} Too many failed attempts to sign in with the console device Laptop, so binference refuses them until Oct 11, 2026, 09:30:00. None of them signed in.`,
  "notice.limitChange":
    "Limit changed by the CLI: the per-trade cap changes at Oct 11, 2026, 09:30:00. Not you? Cancel now.",
  "notice.limitChangeCancelled":
    "Limit change cancelled for the 24-hour cap; the limit in effect stays",
  "notice.ceilingChange": `${warning} The owner key changed the ceiling of main's wallets from the CLI: the most one contract call may carry. Not you? Freeze now.`,
  "notice.signerRevoked": `${warning} The owner key removed the agent key of signer office-mac from every wallet, from the CLI. The machine that held it signs nothing more. Not you? Freeze now.`,
  "notice.sendLevel": "Send level 2 → 1 at Oct 11, 2026, 09:30:00",
  "notice.sendLevelCancelled": "Send level change to 0 cancelled; it stays 2",
  "notice.rescueStopped": `${red} A rescue stopped part way: the rescue address changed while it ran. What was not sent stays in the wallets. Check them, then start a rescue again.`,
  "notice.rescueAddress": `${warning} Rescue address changes to 0x9F3c…41aB at Oct 11, 2026, 09:30:00. Not you? Cancel now.`,
  "notice.rescueAddressCancelled": "Rescue address change to 0x9F3c…41aB cancelled",
  "notice.ceilingOutdated": `${warning} The wallets' ceilings still let sends pay 0x9F3c…41aB. Run \`binference rescue set\` with the owner key to update them.`,
  "notice.plainSecret": `${warning} A secret is written as plain text in config. Run \`binference check --fix\`.`,
  "notice.budget":
    "main used today's model budget ($3.00). Chat resumes Oct 11, 2026, 09:30:00; orders keep running.",
  "notice.loop": "main repeated the same step and was stopped",
  "notice.watcherLag": `${warning} Prices on BNB Smart Chain are read 14 blocks behind the chain, so auto orders may fill late. Add a paid RPC under \`chains.rpc\` in config.json5, or check this machine's network.`,
  "notice.watcherUnpriced": `${warning} Price watching on BNB Smart Chain has no price for 2 watched tokens, 0x9F3c…41aB first, so their auto orders cannot trigger until a price returns. A price comes from a launchpad curve, or a PancakeSwap pool that trades at least $1,000 of WBNB or a stablecoin.`,
  "notice.watcherStopped": `${red} Price watching on BNB Smart Chain stopped on a fault and starts again by itself; auto orders there fill nothing until it does. Run \`binference logs\` to see why.`,
  "notice.resumed": "Engine was off 2 h: 3 orders checked, 1 filled, 2 skipped",
  "notice.update":
    "binference 2027.1.0 is out: Stop-loss orders fill faster. Run `binference update`.",
  "notice.updateBare": "binference 2027.1.0 is out. Run `binference update`.",
  "notice.updated": "binference is now 2027.1.0. What changed: Stop-loss orders fill faster",
  "notice.updatedBare": "binference is now 2027.1.0.",
  "notice.updateRolledBack": `${warning} binference 2027.1.0 failed its check after the update, so binference went back to 2026.12.2. Your settings and records are as they were before.`,
  "notice.backupFailed": `${warning} Last night's backup failed: its second copy in backups.copyTo could not be written`,
  "notice.locked": `${red} binference restarted and is locked. Run \`binference unlock\`.`,
  "notice.signerStopped": `${red} The signer stopped, so binference signs nothing. Fix what \`binference logs\` shows, then run \`binference unlock\`.`,
  "notice.signerRefused": `${warning} The signer refused to sign a step of a trade: its amounts are not the trade's. Nothing was sent for it.`,
  "notice.privyUnreachable": `${red} binference could not reach Privy for five minutes after it started, so it stays locked. Check this machine's network, then run \`binference unlock\`.`,
  "notice.configInvalid": `${warning} binference kept the settings it runs on: config.json5 has a value telegram.mode does not take. Run \`binference check\` to see the fix.`,
  "notice.configChanged": "Settings changed in config.json5: owner.locale. They apply now.",
  "notice.unknownTx": `${warning} Main's nonce 42 was used by a transaction binference did not sign`,
  "notice.fillDiffers": `${warning} A trade settled more than 1% away from its simulation. Check the trade.`,
  "notice.blockShared": `${warning} Two trades of Main landed in one block, so its positions and P&L may count the coin that block paid it twice. Check the wallet.`,
  "notice.fillUnknown": `${warning} A trade settled, but no RPC can say what it received any more. Add a tracing RPC to the config and restart binference to finish it.`,
  "notice.notSigned": `${warning} A trade was cancelled before its first transaction was signed. Nothing was sent.`,
  "notice.confirmationLapsed": `${warning} A trade was not sent: its confirmation ran out before it could go out. Nothing was signed.`,
  "notice.feeAboveCap": `${warning} A trade waited because the network fee was above your cap, and its confirmation ran out. Confirm it again on its new card, or cancel it.`,
  "notice.stepUnsent": `${warning} A trade stopped part way: an earlier step landed on chain, but a later one was never signed. Check the wallet.`,
  "notice.stepDropped": `${warning} A trade was stuck and did not go through. Nothing moved, and the wallet is free again.`,
  "notice.stepDroppedPartWay": `${warning} A trade stopped part way: an earlier step landed on chain, but a later one was stuck and did not go through. The wallet is free again. Check the wallet.`,
  "notice.droppedLanded": `${red} A trade binference reported as stuck went through after all. binference has now counted it toward your limits and positions. Check the wallet.`,
  "notice.walletHeld": `${warning} A transaction of Main is stuck, so the wallet's later trades wait behind it. binference keeps sending it until a block holds it or every relay drops it.`,
  "notice.binanceRefused": `${warning} main tried a trade over its limit: buy $500 of CAKE. Refused.`,
  "notice.binancePaused": "main paused from the Mini App",
  "notice.approvalMode": "main is now in auto mode, from the CLI",
  "notice.alertPrice":
    "PEPE is at or above $0.00001: now $0.000011\nmain is looking into it.\n3 more matches did not wake main: at most 10 wake-ups an hour.",
  "notice.alertWallet": "Whale sold 2M PEPE, 40% of its holding, for $22.10",
  "notice.alertLaunch":
    "New launch passed your filters: PEPE 0x6982…1933 · Pad · 3 min ago · curve 42% · tax 1% · 2 insider wallets · creator's other launches in 30 days: 0",
  "notice.ordersEnded": "Take-profit sold all your PEPE, so your 2 other exit orders on it ended",
  "notice.exitEnded": "Trailing stop on PEPE ended: the wallet holds none of it any more",
};

describe("every notice in the owner's chat, in English", () => {
  it("holds one notice of each key the catalog has, and no other", () => {
    const catalog = Object.keys(messages.en).filter((key) => key.startsWith("notice."));
    expect(Object.keys(noticeTable).toSorted()).toStrictEqual(catalog.toSorted());
  });

  it("sends each notice to the owner's chat as the spec words it", async () => {
    const sent = await sentNoticeTable("en");
    expect(sent.chats).toStrictEqual([ownerId]);
    expect(sent.texts).toStrictEqual(expected);
  });
});
