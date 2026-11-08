// @vitest-environment jsdom
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatScreen } from "../screens/chat-screen";
import { draftAnswers, draftFixture } from "../testing/draft-fixture";
import { fakeClient } from "../testing/fake-client";
import { renderSignedIn, settle } from "../testing/render-signed-in";

afterEach(cleanup);

// jsdom makes no object URLs; the medium's address only has to exist, and each one made is kept.
const made: Blob[] = [];
Object.assign(URL, {
  createObjectURL: (blob: Blob) => {
    made.push(blob);
    return `blob:made-${String(made.length)}`;
  },
  revokeObjectURL: () => undefined,
});

const { agent } = draftFixture;
// An MP4's opening `ftyp` box, 12 bytes, and Ogg's `OggS`, 4 bytes.
const mp4 = "AAAAGGZ0eXBpc29t";
const ogg = "T2dnUw==";
const videoPath = "/owner/.binference/workspace/media/made/2026-11-08/d4e5f60718293a4b.mp4";
const speechPath = "/owner/.binference/workspace/media/speech/2026-11-08/e5f60718293a4b5c.ogg";

/** What a push names: the medium's id, kind, format, size and where it was saved. */
interface Pushed {
  readonly media: string;
  readonly kind: "video" | "voice";
  readonly contentType: string;
  readonly bytes: number;
  readonly path: string;
}

const video: Pushed = {
  media: "d4e5f60718293a4b",
  kind: "video",
  contentType: "video/mp4",
  bytes: 12,
  path: videoPath,
};
const voice: Pushed = {
  media: "e5f60718293a4b5c",
  kind: "voice",
  contentType: "audio/ogg",
  bytes: 4,
  path: speechPath,
};

async function pushMedia(engine: ReturnType<typeof fakeClient>, media: Pushed): Promise<void> {
  await act(async () => {
    engine.push(`chat:${agent}`, "chat/media", {
      agent,
      turn: "trn_0190f1c2-3a4b-7c5d-8e6f-000000000009",
      media,
    });
    return Promise.resolve();
  });
  await settle();
}

const answers = {
  ...draftAnswers,
  "launch/openDraft": () => ({}),
  "media/read": (args: unknown) =>
    JSON.stringify(args).includes(video.media)
      ? { contentType: "video/mp4", bytes: 12, offset: 0, data: mp4 }
      : { contentType: "audio/ogg", bytes: 4, offset: 0, data: ogg },
};

describe("the videos and speech the agent made, in the chat", () => {
  it("plays a video and speech from the bytes the engine answers by their ids", async () => {
    made.length = 0;
    const engine = fakeClient(answers);
    const { container } = renderSignedIn(<ChatScreen />, { client: engine.client });
    await settle();
    await pushMedia(engine, video);
    await pushMedia(engine, voice);
    expect(container.querySelector("video")?.getAttribute("aria-label")).toBe(
      "A video the agent made",
    );
    expect(container.querySelector("audio")?.getAttribute("src")).toMatch(/^blob:made-/u);
    expect(made.map((blob) => [blob.type, blob.size])).toStrictEqual([
      ["video/mp4", 12],
      ["audio/ogg", 4],
    ]);
    expect(screen.getByText(videoPath)).toBeDefined();
    expect(screen.getByText(speechPath)).toBeDefined();
    expect(engine.calls.filter(({ op }) => op === "media/read")).toStrictEqual([
      { op: "media/read", args: { agent, media: video.media } },
      { op: "media/read", args: { agent, media: voice.media } },
    ]);
  });

  it("says the engine no longer holds a medium it cannot read, and still names its path", async () => {
    const engine = fakeClient({
      ...answers,
      "media/read": () => {
        throw Object.assign(new Error("gone"), { code: "media.not_found" });
      },
    });
    const { container } = renderSignedIn(<ChatScreen />, { client: engine.client });
    await settle();
    await pushMedia(engine, video);
    expect(container.querySelector("video")).toBeNull();
    expect(screen.getByText(/no longer holds this/u)).toBeDefined();
    expect(screen.getByText(videoPath)).toBeDefined();
  });
});
