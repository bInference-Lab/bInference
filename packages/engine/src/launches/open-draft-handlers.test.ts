import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { imagePartBytes, noUploadImage } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { testPng } from "../chat/test-images.js";
import { expectOk, testAgent, testNowMs } from "../intents/test-intents.js";
import { testLaunch } from "../money-path/test-launches.js";
import { testCall, testChains } from "../operations/test-engine.js";
import { sha256HexSchema } from "../records/sha256-hex.js";
import { createUploadShelf } from "../uploads/upload-shelf.js";
import { createLaunchDraftDesk } from "./launch-draft-desk.js";
import { createLaunchDraftShelf, type LaunchDraft } from "./launch-draft-shelf.js";
import { createOpenDraftHandlers } from "./open-draft-handlers.js";

const draftId = "c2hvd24tb25jZS1h";
const draft: LaunchDraft = {
  id: draftId,
  ref: "d3Zr_x9-AbCdEfGh",
  agentId: testAgent,
  agentName: "main",
  request: { ...testLaunch, image: noUploadImage },
  settings: [],
  hasOutsideContent: true,
  expiresAtMs: testNowMs + 600_000,
};

// A photo of 600 KiB that opens as a PNG, read in two parts.
const largePng = Uint8Array.from({ length: 600 * 1024 }, (_, at) => testPng[at] ?? at % 251);
const pictured: LaunchDraft = {
  ...draft,
  picture: {
    bytes: largePng,
    image: {
      contentType: "image/png",
      bytes: largePng.byteLength,
      sha256: sha256HexSchema.parse("a".repeat(64)),
    },
  },
};

function handlersOver(held: LaunchDraft | undefined) {
  const clock = createManualClock(testNowMs);
  const shelf = createLaunchDraftShelf();
  if (held !== undefined) {
    shelf.put(held);
  }
  const desk = createLaunchDraftDesk({
    shelf,
    host: { picturePlace: () => (held?.picture === undefined ? "link" : "upload") },
    chains: testChains(),
    uploads: createUploadShelf({ clock, random: createSeededRandom(1) }),
    propose: async () => Promise.reject(new Error("No proposal is expected.")),
    intents: {
      byDraftRef: async () => Promise.resolve(undefined),
      cards: async () => Promise.resolve([]),
    },
    owners: { get: async () => Promise.resolve(undefined) },
    clock,
    publish: () => undefined,
  });
  const handlers = createOpenDraftHandlers(desk);
  return {
    clock,
    desk,
    open: async () => handlers["launch/openDraft"](testCall({ agent: testAgent })),
    picture: async (id: string, offset?: number) =>
      handlers["launch/draftPicture"](
        testCall({ agent: testAgent, draft: id, ...(offset === undefined ? {} : { offset }) }),
      ),
  };
}

const notFound = { ok: false, error: "image.not_found" };

describe("the reads of the agent's open launch draft", () => {
  it("answers the draft's lines as Telegram's message shows them, and its photo's size", async () => {
    const { open, desk } = handlersOver(pictured);
    const showing = desk.showing(draftId);
    expect(await open()).toStrictEqual({
      ok: true,
      value: {
        draft: {
          draft: draftId,
          expiresAt: testNowMs + 600_000,
          lines: showing?.lines,
          assets: showing?.assets,
          picture: { bytes: 600 * 1024 },
        },
      },
    });
    expect(showing?.lines.map(({ key }) => key)).toContain("card.warn.outsideContent");
  });

  it("answers the photo in parts of 512 KiB, the same bytes the draft holds", async () => {
    const { picture } = handlersOver(pictured);
    const first = await picture(draftId);
    const second = await picture(draftId, imagePartBytes);
    expect(first).toMatchObject({
      ok: true,
      value: { contentType: "image/png", offset: 0, next: imagePartBytes },
    });
    expect(second).toMatchObject({ ok: true, value: { offset: imagePartBytes } });
    expect(second).not.toHaveProperty("value.next");
    const data = [first, second].map((part) => Buffer.from(expectOk(part).data, "base64"));
    expect(Buffer.concat(data).equals(Buffer.from(largePng))).toBe(true);
    expect(await picture(draftId, 600 * 1024)).toStrictEqual({
      ok: false,
      error: "protocol.bad_args",
    });
  });

  it("answers no photo for another draft, and nothing once the draft's time is up", async () => {
    const { open, picture, clock } = handlersOver(pictured);
    expect(await picture("b3RoZXItZHJhZnQx")).toStrictEqual(notFound);
    await clock.advance(600_000);
    expect(await open()).toStrictEqual({ ok: true, value: {} });
    expect(await picture(draftId)).toStrictEqual(notFound);
  });

  it("answers a draft with a picture link without a photo, and none without a draft", async () => {
    const linked = handlersOver(draft);
    expect(await linked.open()).not.toHaveProperty("value.draft.picture");
    expect(await linked.picture(draftId)).toStrictEqual(notFound);
    expect(await handlersOver(undefined).open()).toStrictEqual({ ok: true, value: {} });
  });
});
