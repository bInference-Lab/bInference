import { createFormatter } from "@binference/i18n";
import { describe, expect, it } from "vitest";
import {
  lockedNotice,
  lockedNoticeKey,
  privyUnreachableNotice,
  privyUnreachableNoticeKey,
  signerStoppedNotice,
  signerStoppedNoticeKey,
} from "./locked-notice.js";

const alarm = String.fromCodePoint(0x1f534);

describe("the locked notice", () => {
  it("reaches every reading client on the notice topic and names no agent", () => {
    expect(lockedNotice()).toStrictEqual({
      topic: "notice",
      kind: "notice/new",
      data: { key: "notice.locked", values: {} },
    });
  });

  it("tells the owner to run binference unlock", () => {
    const english = createFormatter({ locale: "en", timeZone: "UTC" });
    expect(english.message(lockedNoticeKey)).toBe(
      `${alarm} binference restarted and is locked. Run \`binference unlock\`.`,
    );
  });

  it("tells every surface when the signer stops, and how to start it again", () => {
    expect(signerStoppedNotice()).toStrictEqual({
      topic: "notice",
      kind: "notice/new",
      data: { key: "notice.signerStopped", values: {} },
    });
    const english = createFormatter({ locale: "en", timeZone: "UTC" });
    expect(english.message(signerStoppedNoticeKey)).toBe(
      `${alarm} The signer stopped, so binference signs nothing. Fix what \`binference logs\` shows, then run \`binference unlock\`.`,
    );
  });

  it("tells every surface when Privy stayed out of reach after the start", () => {
    expect(privyUnreachableNotice()).toStrictEqual({
      topic: "notice",
      kind: "notice/new",
      data: { key: "notice.privyUnreachable", values: {} },
    });
    const english = createFormatter({ locale: "en", timeZone: "UTC" });
    expect(english.message(privyUnreachableNoticeKey)).toBe(
      `${alarm} binference could not reach Privy for five minutes after it started, so it stays locked. Check this machine's network, then run \`binference unlock\`.`,
    );
  });
});
