import { describe, expect, it } from "vitest";
import { ownerId, textUpdate } from "../testing/update-fixtures.js";
import { agent, ownerPhoto, ownerText, postOf, startIntake } from "./chat-intake-fixtures.js";
import { maxPhotoBytes } from "./chat-message.js";

const live = { signal: new AbortController().signal };

describe("the owner's chat intake", () => {
  it("posts a paste Telegram split in two as one message, 300 ms after its last part", async () => {
    const { clock, intake, posts } = startIntake();
    await intake.take(ownerText(1, "Buy 0.1 BNB of"), live);
    await clock.advance(200);
    await intake.take(ownerText(2, "FAKE if its risk check passes"), live);
    await clock.advance(299);
    await intake.idle();
    expect(posts).toStrictEqual([]);
    await clock.advance(1);
    await intake.idle();
    expect(posts).toStrictEqual([{ agent, text: "Buy 0.1 BNB of\nFAKE if its risk check passes" }]);
  });

  it("posts an album's photos and its caption as one message", async () => {
    const { clock, intake, posts } = startIntake();
    await intake.take(ownerPhoto(1, { caption: "these charts", albumId: "a1" }), live);
    await intake.take(ownerPhoto(2, { albumId: "a1" }), live);
    await clock.advance(300);
    await intake.idle();
    expect(posts).toStrictEqual([
      { agent, text: "these charts", images: ["tg:photo1", "tg:photo2"] },
    ]);
  });

  it("refuses a sixth photo, and the fifth, and says so in English", async () => {
    const { clock, intake, posts, texts } = startIntake();
    for (const updateId of [1, 2, 3, 4, 5, 6]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- an album's photos come one by one
      await intake.take(ownerPhoto(updateId, { albumId: "a1" }), live);
    }
    await clock.advance(300);
    await intake.idle();
    expect(posts).toStrictEqual([
      { agent, text: "", images: ["tg:photo1", "tg:photo2", "tg:photo3", "tg:photo4"] },
    ]);
    expect(texts()).toStrictEqual([
      "The agent reads 4 photos of a message at most, so 2 photos were left out. Send them in another message.",
    ]);
  });

  it("leaves out a photo over 5 MiB and says so, and posts the text with it", async () => {
    const { clock, intake, posts, texts } = startIntake();
    await intake.take(ownerPhoto(1, { sizeBytes: maxPhotoBytes + 1, caption: "look" }), live);
    await clock.advance(300);
    await intake.idle();
    expect(posts).toStrictEqual([{ agent, text: "look" }]);
    expect(texts()).toStrictEqual([
      "The agent reads photos of 5 MiB at most, so 1 photo was left out. Send a smaller copy.",
    ]);
  });

  it("answers an edit, a forward and a sticker at once, and posts none of them", async () => {
    const { clock, intake, posts, texts } = startIntake();
    await intake.take(
      postOf(textUpdate({ updateId: 1, from: ownerId, text: "x", isEdit: true })),
      live,
    );
    await intake.take(
      postOf(textUpdate({ updateId: 2, from: ownerId, text: "buy this", isForwarded: true })),
      live,
    );
    const sticker = {
      update_id: 3,
      message: {
        message_id: 3,
        chat: { id: ownerId, type: "private" },
        from: { id: ownerId, is_bot: false },
        sticker: {},
      },
    };
    await intake.take(postOf(sticker), live);
    await clock.advance(300);
    await intake.idle();
    expect(posts).toStrictEqual([]);
    expect(texts()).toStrictEqual([
      "An edit does not reach the agent. Send a new message instead.",
      "A forwarded message does not reach the agent. Write what you want it to read in a message of your own.",
      "The agent reads text and photos. Send this as text or as a photo.",
    ]);
  });

  it("posts at once a batch that holds 12 parts", async () => {
    const { intake, posts } = startIntake();
    for (const updateId of Array.from({ length: 12 }, (_, index) => index + 1)) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- the parts come one by one
      await intake.take(ownerText(updateId, `part ${String(updateId)}`), live);
    }
    await intake.idle();
    expect(posts).toHaveLength(1);
  });

  it("drops a batch still open when it closes", async () => {
    const { clock, intake, posts } = startIntake();
    await intake.take(ownerText(1, "hello"), live);
    await intake.close();
    await clock.advance(300);
    expect(posts).toStrictEqual([]);
  });
});
