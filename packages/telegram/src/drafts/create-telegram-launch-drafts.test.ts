import { describe, expect, it } from "vitest";
import {
  closedDraft,
  draftRef,
  live,
  openedDraft,
  pressOf,
  setUpDrafts,
} from "../testing/draft-fixtures.js";
import { ownerId, strangerId } from "../testing/update-fixtures.js";

const done = String.fromCodePoint(0x2705);
const waiting = String.fromCodePoint(0x1f7e1);
const refused = String.fromCodePoint(0x274c);
const warning = `${String.fromCodePoint(0x26a0)}${String.fromCodePoint(0xfe0f)}`;

describe("the agent's launch drafts in Telegram", () => {
  it("sends the draft with every line, its words made visible, and Start launch and Drop", async () => {
    const context = await setUpDrafts();
    await context.drafts.show(openedDraft, live);
    const [message] = context.botApi.messages();
    expect(message?.text.split("\n")).toStrictEqual([
      "main drafted this token launch. Nothing is uploaded or public until you tap Start launch.",
      "Description: A cat\\u{202E} <b>on</b> the moon",
      "Website: https://moon.example",
      "Picture: your photo from the chat, PNG, 1 KB, SHA-256 a96735a8ad139cd1",
      "After Start launch, the launch card shows the launch fee, the new token and the least the first buy gets, and you confirm there. This draft ends at 08:10:00.",
    ]);
    expect(message?.buttons).toStrictEqual([
      [
        { text: "Start launch", data: `bnf1:s:y:${draftRef}` },
        { text: "Drop", data: `bnf1:s:n:${draftRef}` },
      ],
    ]);
  });

  it("starts the draft on the owner's Start, says it is starting and answers the press at once", async () => {
    const context = await setUpDrafts();
    await context.drafts.show(openedDraft, live);
    expect(await context.drafts.press(pressOf(context, `bnf1:s:y:${draftRef}`), live)).toBe(true);
    expect(context.answers.started()).toStrictEqual([
      { ref: draftRef, start: true, presserId: ownerId },
    ]);
    const answers = context.botApi.answers().map((answer) => answer.text);
    expect(answers).toStrictEqual(["Starting the launch. The draft's message says how it goes."]);
    expect(context.botApi.messages()).toMatchObject([
      { text: `${waiting} Starting the launch. This message says how it ends.`, buttons: [] },
    ]);
  });

  it("starts nothing and answers nothing for a stranger, and leaves other data alone", async () => {
    const context = await setUpDrafts();
    await context.drafts.show(openedDraft, live);
    expect(
      await context.drafts.press(pressOf(context, `bnf1:s:y:${draftRef}`, strangerId), live),
    ).toBe(true);
    expect(await context.drafts.press(pressOf(context, `bnf1:q:0:${draftRef}`), live)).toBe(false);
    expect(await context.drafts.press(pressOf(context, "bnf1:s:x:AAAAAAAAAAAAAAAA"), live)).toBe(
      false,
    );
    expect([context.answers.started(), context.botApi.answers()]).toStrictEqual([[], []]);
  });

  it.each([
    [
      "started",
      {},
      `${done} Launch started. Its card follows: confirm there before anything is signed.`,
    ],
    ["dropped", {}, `${refused} Launch draft dropped. Nothing was uploaded.`],
    [
      "expired",
      {},
      `${refused} This launch draft ended after 10 minutes. Nothing was uploaded. Ask your agent to draft it again.`,
    ],
    ["replaced", {}, `${refused} A newer launch draft replaced this one. Nothing was uploaded.`],
    [
      "failed",
      { intent: "int_0190f1c2-3a4b-7c5d-8e6f-000000000285", reason: "per_trade_cap" },
      `${refused} The launch ended before its card: it is above your per-trade cap. Nothing was signed.`,
    ],
    [
      "failed",
      { error: "intent.launch_waiting" },
      `${refused} The launch did not start: Another token launch of this agent is under way, waiting for its pin or the owner's confirmation. Let it finish, or deny its card, before starting the next.`,
    ],
  ] as const)("turns the draft's message into how it ended: %s", async (outcome, extra, line) => {
    const context = await setUpDrafts();
    await context.drafts.show(openedDraft, live);
    await context.drafts.show(closedDraft(outcome, extra), live);
    expect(context.botApi.messages()).toMatchObject([{ text: line, buttons: [] }]);
  });

  it("sends the held photo right above the draft, which replies to it", async () => {
    const context = await setUpDrafts("en", { photo: { fileId: "AgACforkcat", held: "photo" } });
    await context.drafts.show(openedDraft, live);
    const [photo, draft] = context.botApi.sent();
    const [photoMessage] = context.botApi.messages();
    expect(photo?.file).toStrictEqual({ kind: "photo", fileId: "AgACforkcat" });
    expect(draft?.replyTo).toBe(photoMessage?.messageId);
    expect(context.botApi.messages()[1]?.buttons[0]?.map(({ text }) => text)).toStrictEqual([
      "Start launch",
      "Drop",
    ]);
  });

  it("sends a photo the owner sent as a file again as a file", async () => {
    const context = await setUpDrafts("en", { photo: { fileId: "BQACforkcat", held: "document" } });
    await context.drafts.show(openedDraft, live);
    expect(context.botApi.sent()[0]?.file).toStrictEqual({
      kind: "document",
      fileId: "BQACforkcat",
    });
  });

  it("offers only Drop when the bot cannot show the draft's picture", async () => {
    const context = await setUpDrafts("en", { photo: { fileId: "AgACgone" } });
    await context.drafts.show(openedDraft, live);
    const [message] = context.botApi.messages();
    expect(message?.buttons).toStrictEqual([[{ text: "Drop", data: `bnf1:s:n:${draftRef}` }]]);
    expect(message?.text.split("\n").at(-2)).toBe(
      `${warning} binference could not show the picture here, so this draft cannot start. Ask your agent to draft it again.`,
    );
  });

  it("answers the owner's press on a draft the engine no longer holds, and drops its buttons", async () => {
    const context = await setUpDrafts();
    await context.drafts.show(openedDraft, live);
    expect(await context.drafts.press(pressOf(context, "bnf1:s:y:AAAAAAAAAAAAAAAA"), live)).toBe(
      true,
    );
    expect(context.botApi.answers().map((answer) => answer.text)).toStrictEqual([
      "binference no longer holds this draft. Ask your agent to draft it again.",
    ]);
    expect(context.botApi.messages()).toMatchObject([
      {
        text: `${refused} binference no longer holds this launch draft, after a restart or a newer draft. Ask your agent to draft it again.`,
        buttons: [],
      },
    ]);
  });

  it("splits a draft past one message's 4,096 characters, the buttons on the last", async () => {
    const context = await setUpDrafts("en", { description: "\u200B".repeat(1000) });
    await context.drafts.show(openedDraft, live);
    const messages = context.botApi.messages();
    expect(messages.map(({ text }) => text.length <= 4096)).toStrictEqual([true, true, true, true]);
    expect(messages.map(({ buttons }) => buttons.length)).toStrictEqual([0, 0, 0, 1]);
    expect(messages.map(({ text }) => text).join("")).toContain("\\u{200B}".repeat(1000));
  });
});
