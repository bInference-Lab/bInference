import type { ReplyRewrites } from "./rewrite-replies";

// The smoke engine's agent drafts no launch, so the smoke test gives the chat the draft the unit
// tests read: a launch of MCAT on flap with the owner's photo, a 48x48 PNG, read in one part.

const coin = "fake:1/slip44:1";
const draft = "c2hvd24tb25jZS1h";
const photo =
  "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAAO0lEQVR42u3OMQ0AAAgDsP34F4MrJOCCcDSpgGa6XomQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQ0J0FPt5U4ukFd9UAAAAASUVORK5CYII=";
const photoBytes = 116;
const text = (value: string) => ({ type: "text", text: value });

const lines = [
  {
    key: "card.launch.action",
    values: {
      symbol: text("MCAT"),
      tokenName: text("Moon Cat"),
      venue: text("flap"),
      pair: { type: "asset", asset: coin },
      firstBuy: { type: "amount", amount: { asset: coin, base: "100000000000000000" } },
    },
  },
  { key: "card.launch.description", values: { description: text("A cat on the moon") } },
  {
    key: "card.launch.link",
    values: { site: { type: "choice", choice: "website" }, url: text("https://moon.example") },
  },
  {
    key: "card.launch.photo",
    values: {
      format: { type: "choice", choice: "png" },
      kib: { type: "count", count: 1 },
      digest: text("a96735a8ad139cd1"),
    },
  },
  { key: "card.launch.startPublishes", values: { venue: text("flap") } },
];

/** The draft, open for 10 minutes from when the page asks, and its photo. */
export const openDraft: ReplyRewrites = {
  "launch/openDraft": () => ({
    draft: {
      draft,
      expiresAt: Date.now() + 600_000,
      lines,
      assets: { [coin]: { symbol: "FAKE", name: "Fake coin", decimals: 18, verified: true } },
      picture: { bytes: photoBytes },
    },
  }),
  "launch/draftPicture": () => ({
    contentType: "image/png",
    bytes: photoBytes,
    offset: 0,
    data: photo,
  }),
};
