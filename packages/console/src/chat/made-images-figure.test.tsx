// @vitest-environment jsdom
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatScreen } from "../screens/chat-screen";
import { draftAnswers, draftFixture } from "../testing/draft-fixture";
import { fakeClient } from "../testing/fake-client";
import { renderSignedIn, settle } from "../testing/render-signed-in";

afterEach(cleanup);

// jsdom makes no object URLs; the image's address only has to exist, and each one made is kept.
const made: Blob[] = [];
Object.assign(URL, {
  createObjectURL: (blob: Blob) => {
    made.push(blob);
    return `blob:made-${String(made.length)}`;
  },
  revokeObjectURL: () => undefined,
});

const { agent } = draftFixture;
const pixelPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const path = "/owner/.binference/workspace/media/made/2026-11-07/a1b2c3d4e5f60718.png";
const answers = {
  ...draftAnswers,
  "launch/openDraft": () => ({}),
  "image/read": () => ({ contentType: "image/png", bytes: 70, offset: 0, data: pixelPng }),
};

async function pushImages(engine: ReturnType<typeof fakeClient>, image: string): Promise<void> {
  await act(async () => {
    engine.push(`chat:${agent}`, "chat/images", {
      agent,
      turn: "trn_0190f1c2-3a4b-7c5d-8e6f-000000000009",
      prompt: "A frog logo.",
      images: [{ image, contentType: "image/png", bytes: 70, path }],
    });
    return Promise.resolve();
  });
  await settle();
}

describe("the images the agent made, in the chat", () => {
  it("draws each from the bytes the engine answers by its id, with where it was saved", async () => {
    made.length = 0;
    const engine = fakeClient(answers);
    renderSignedIn(<ChatScreen />, { client: engine.client });
    await settle();
    await pushImages(engine, "a1b2c3d4e5f60718");
    const image = screen.getByRole("img", { name: "An image the agent made" });
    expect(image.getAttribute("src")).toMatch(/^blob:made-/u);
    expect(made.map((blob) => [blob.type, blob.size])).toStrictEqual([["image/png", 70]]);
    expect(screen.getByText(path)).toBeDefined();
    expect(engine.calls.filter(({ op }) => op === "image/read")).toStrictEqual([
      { op: "image/read", args: { agent, image: "a1b2c3d4e5f60718", offset: 0 } },
    ]);
  });

  it("says the engine no longer holds an image it cannot read, and still names its path", async () => {
    const engine = fakeClient({
      ...answers,
      "image/read": () => {
        throw Object.assign(new Error("gone"), { code: "image.not_found" });
      },
    });
    renderSignedIn(<ChatScreen />, { client: engine.client });
    await settle();
    await pushImages(engine, "ffffffffffffffff");
    expect(screen.queryByRole("img", { name: "An image the agent made" })).toBeNull();
    expect(screen.getByText(/no longer held/u)).toBeDefined();
    expect(screen.getByText(path)).toBeDefined();
  });
});
