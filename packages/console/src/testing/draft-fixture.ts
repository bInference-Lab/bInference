import type { FakeAnswers } from "./fake-client";

// The agent's launch draft as `launch/openDraft` answers it, with the owner's photo, a 1x1 PNG,
// read in one part through `launch/draftPicture`. Its words are the agent's, a control character
// and markup among them.

/** The chat's agent, and its draft's id. */
export const draftFixture = {
  agent: "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  draft: "c2hvd24tb25jZS1h",
  // 2026-11-03 12:10 UTC.
  expiresAt: 1_793_707_800_000,
} as const;

// A 1x1 PNG in base64.
const pixelPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const pixelBytes = 70;

const bnb = "eip155:56/slip44:714";

const text = (value: string) => ({ type: "text", text: value });
const choice = (value: string) => ({ type: "choice", choice: value });

// The lines of the draft, as Telegram's message shows them between its header and footer.
const lines = [
  {
    key: "card.launch.action",
    values: {
      symbol: text("MCAT"),
      tokenName: text("Moon Cat"),
      venue: text("flap"),
      pair: { type: "asset", asset: bnb },
      firstBuy: { type: "amount", amount: { asset: bnb, base: 10n ** 17n } },
    },
  },
  {
    key: "card.launch.description",
    values: { description: text("A cat\u202e <b>on</b> the moon") },
  },
  {
    key: "card.launch.link",
    values: { site: choice("website"), url: text("https://moon.example") },
  },
  {
    key: "card.launch.photo",
    values: {
      format: choice("png"),
      kib: { type: "count", count: 1 },
      digest: text("a96735a8ad139cd1"),
    },
  },
  { key: "card.launch.startPublishes", values: { venue: text("flap") } },
  { key: "card.warn.outsideContent", values: {} },
];

/** `launch/openDraft`'s answer while the draft is open. */
export const openDraftAnswer = {
  draft: {
    draft: draftFixture.draft,
    expiresAt: draftFixture.expiresAt,
    lines,
    assets: { [bnb]: { symbol: "BNB", name: "BNB", decimals: 18, verified: true } },
    picture: { bytes: pixelBytes },
  },
};

/** The engine's answers for the chat with the draft open, and the photo's one part. */
export const draftAnswers: FakeAnswers = {
  "agent/list": () => ({
    items: [
      {
        agent: draftFixture.agent,
        name: "main",
        mode: "live",
        locale: "en",
        createdAt: 1,
        changedAt: 1,
      },
    ],
  }),
  "chat/messages": () => ({ items: [] }),
  "intent/list": () => ({ items: [] }),
  "chat/openQuestion": () => ({}),
  "launch/openDraft": () => openDraftAnswer,
  "launch/draftPicture": () => ({
    contentType: "image/png",
    bytes: pixelBytes,
    offset: 0,
    data: pixelPng,
  }),
};
