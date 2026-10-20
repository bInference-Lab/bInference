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
const refused = String.fromCodePoint(0x274c);

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

  it("starts the draft on the owner's Start, and answers the press in under 200 characters", async () => {
    const context = await setUpDrafts();
    await context.drafts.show(openedDraft, live);
    expect(await context.drafts.press(pressOf(context, `bnf1:s:y:${draftRef}`), live)).toBe(true);
    expect(context.answers.started()).toStrictEqual([
      { ref: draftRef, start: true, presserId: ownerId },
    ]);
    const answers = context.botApi.answers().map((answer) => answer.text);
    expect(answers).toStrictEqual(["Launch started. Its card follows."]);
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
      { error: "intent.launch_waiting" },
      `${refused} The launch did not start: Another token launch of this agent is under way, waiting for its pin or the owner's confirmation. Let it finish, or deny its card, before starting the next.`,
    ],
  ] as const)("turns the draft's message into how it ended: %s", async (outcome, extra, line) => {
    const context = await setUpDrafts();
    await context.drafts.show(openedDraft, live);
    await context.drafts.show(closedDraft(outcome, extra), live);
    expect(context.botApi.messages()).toMatchObject([{ text: line, buttons: [] }]);
  });
});
