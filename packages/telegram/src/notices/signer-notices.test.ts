import { describe, expect, it } from "vitest";
import { ownerId } from "../testing/update-fixtures.js";
import { sentNoticeTable } from "./notice-table-fixtures.js";
import { signerNoticeVariants } from "./signer-notice-variants.js";

const warning = String.fromCodePoint(0x26a0, 0xfe0f);
const refused = `${warning} The signer refused to sign a step of a trade:`;
const nothingSent = "Nothing was sent for it.";

describe("every form a signer service's refusal takes, in English", () => {
  it("sends each to the owner's chat as the spec words it", async () => {
    const sent = await sentNoticeTable("en", signerNoticeVariants);
    expect(sent.chats).toStrictEqual([ownerId]);
    expect(sent.texts).toStrictEqual({
      "notice.signerRefused unknown_wallet": `${refused} it is from a wallet the signer service does not know. ${nothingSent}`,
      "notice.signerRefused intent_state": `${refused} the trade was no longer under way. ${nothingSent}`,
      "notice.signerRefused no_authorization": `${refused} no confirmation or grant stood behind it. ${nothingSent}`,
      "notice.signerRefused authorization_ended": `${refused} the confirmation or the grant behind it had run out before it was signed. ${nothingSent}`,
      "notice.signerRefused terms_changed": `${refused} its terms are not the ones that were confirmed. ${nothingSent}`,
      "notice.signerRefused nonce_held": `${refused} another trade of the wallet still holds its nonce, so propose it again once that trade ends. ${nothingSent}`,
      "notice.signerRefused privy_refused": `${refused} Privy refused it: the wallet's ceiling does not allow it, or bInference's signer service was removed from the wallet. Check the wallet on binference.io. ${nothingSent}`,
    });
  });
});
