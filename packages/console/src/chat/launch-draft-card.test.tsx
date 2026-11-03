// @vitest-environment jsdom
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatScreen } from "../screens/chat-screen";
import { draftAnswers, draftFixture, openDraftAnswer } from "../testing/draft-fixture";
import { fakeClient } from "../testing/fake-client";
import { renderSignedIn, settle } from "../testing/render-signed-in";

afterEach(cleanup);

// jsdom makes no object URLs; the picture's address only has to exist, and each one made is kept.
const made: Blob[] = [];
Object.assign(URL, {
  createObjectURL: (blob: Blob) => {
    made.push(blob);
    return `blob:draft-${String(made.length)}`;
  },
  revokeObjectURL: () => undefined,
});

const { agent, draft } = draftFixture;
const topic = `chat:${agent}` as const;

function draftCard(): HTMLElement {
  return screen.getByRole("region", { name: /^main drafted this token launch\./u });
}

function linesOf(card: HTMLElement): readonly string[] {
  return [...card.querySelectorAll("p")].map((line) => line.textContent);
}

describe("the agent's launch draft in the chat", () => {
  it("shows every line Telegram shows, read-only, and says to start it in Telegram", async () => {
    const engine = fakeClient(draftAnswers);
    renderSignedIn(<ChatScreen />, { client: engine.client });
    await settle();
    expect(linesOf(draftCard())).toStrictEqual([
      "main drafted this token launch. Nothing is uploaded or public until you tap Start launch in Telegram.",
      "Launch MCAT (Moon Cat) on flap, paired with BNB · first buy 0.1 BNB",
      "Description: A cat\\u{202E} <b>on</b> the moon",
      "Website: https://moon.example",
      "Picture: your photo from the chat, PNG, 1 KB, SHA-256 a96735a8ad139cd1",
      "Warning Start launch makes the picture and words public on flap's storage at once, and they stay public if you cancel the card",
      "Warning This came after reading outside content (web, X, token data or an image)",
      "Start it from this draft in your Telegram chat with the bot; the console only shows it. " +
        "After Start launch, the launch card shows the launch fee, the new token and the least the " +
        "first buy gets, and you confirm there. This draft ends at 12:10:00.",
    ]);
    expect(within(draftCard()).queryAllByRole("button")).toStrictEqual([]);
  });

  it("shows the owner's photo from its bytes, with the type its first bytes name", async () => {
    made.length = 0;
    const engine = fakeClient(draftAnswers);
    renderSignedIn(<ChatScreen />, { client: engine.client });
    await settle();
    const picture = within(draftCard()).getByRole("img", {
      name: "The picture of the launch draft",
    });
    expect(picture.getAttribute("src")).toMatch(/^blob:draft-/u);
    expect(made.map((blob) => [blob.type, blob.size])).toStrictEqual([["image/png", 70]]);
    expect(engine.calls.filter(({ op }) => op === "launch/draftPicture")).toStrictEqual([
      { op: "launch/draftPicture", args: { agent, draft, offset: 0 } },
    ]);
  });

  it("shows no picture whose first bytes name no PNG, JPEG or WebP", async () => {
    made.length = 0;
    const engine = fakeClient({
      ...draftAnswers,
      "launch/draftPicture": () => ({
        contentType: "image/png",
        bytes: 70,
        offset: 0,
        data: btoa("GIF89a".padEnd(70, "x")),
      }),
    });
    renderSignedIn(<ChatScreen />, { client: engine.client });
    await settle();
    expect(within(draftCard()).queryByRole("img")).toBeNull();
    expect(made).toStrictEqual([]);
  });

  it("reads the draft when its push arrives, and says how it ended once it closes", async () => {
    const state: { open: object } = { open: {} };
    const engine = fakeClient({ ...draftAnswers, "launch/openDraft": () => state.open });
    renderSignedIn(<ChatScreen />, { client: engine.client });
    await settle();
    expect(screen.queryByRole("region", { name: /drafted this token launch/u })).toBeNull();
    state.open = openDraftAnswer;
    act(() => engine.push(topic, "chat/launchDraft", { agent, draft, expiresAt: 1 }));
    await settle();
    expect(draftCard()).toBeDefined();
    state.open = {};
    act(() => engine.push(topic, "chat/launchDraftClosed", { agent, draft, outcome: "started" }));
    await settle();
    expect(linesOf(draftCard()).at(-1)).toBe(
      "Passed Launch started. Its card follows: confirm there before anything is signed.",
    );
  });

  it.each([
    [{ outcome: "dropped" }, "Refused Launch draft dropped. Nothing was uploaded."],
    [
      { outcome: "failed", error: "intent.launch_waiting" },
      expect.stringMatching(/^Refused The launch did not start: /u),
    ],
    [
      { outcome: "failed", reason: "honeypot" },
      expect.stringMatching(
        /^Refused The launch ended before its card: .+\. Nothing was signed\.$/u,
      ),
    ],
  ])("says how a draft ended: %o", async (closed, line) => {
    const state: { open: object } = { open: openDraftAnswer };
    const engine = fakeClient({ ...draftAnswers, "launch/openDraft": () => state.open });
    renderSignedIn(<ChatScreen />, { client: engine.client });
    await settle();
    state.open = {};
    act(() => engine.push(topic, "chat/launchDraftClosed", { agent, draft, ...closed }));
    await settle();
    expect(linesOf(draftCard()).at(-1)).toStrictEqual(line);
  });
});
