import { describe, expect, it } from "vitest";
import { expectOk } from "../intents/test-intents.js";
import {
  draftArgs,
  draftOf,
  draftTerms,
  draftText,
  testDraftEngine,
} from "./test-launch-drafts.js";

describe("launch/draft, in Chinese", () => {
  it("shows a token name of 64 characters whole", async () => {
    const { test } = await testDraftEngine();
    const name = "Moon Cat Official Community Token 2026 | claim at scam.example!!";
    const drafted = expectOk(await draftOf(test, draftArgs({ launch: { ...draftTerms, name } })));
    expect(draftText(test, drafted.draft, "zh")[0]).toBe(
      `在 fake-curve 发射 MCAT（${name}），与 FAKE 配对交易 · 首笔买入 0.000000000001 FAKE`,
    );
  });
});
