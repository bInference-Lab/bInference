// @vitest-environment jsdom
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatScreen } from "../screens/chat-screen";
import { draftAnswers, draftFixture, openDraftAnswer } from "../testing/draft-fixture";
import { fakeClient } from "../testing/fake-client";
import { renderSignedIn, settle } from "../testing/render-signed-in";

afterEach(cleanup);

Object.assign(URL, { createObjectURL: () => "blob:draft", revokeObjectURL: () => undefined });

const { agent, draft } = draftFixture;

function linesOf(): readonly string[] {
  const card = screen.getByRole("region", { name: /^main 起草了这次代币发射。/u });
  return [...card.querySelectorAll("p")].map((line) => line.textContent);
}

describe("the agent's launch draft in Chinese", () => {
  it("shows the draft in the owner's language, and says to start it in Telegram", async () => {
    const engine = fakeClient(draftAnswers);
    renderSignedIn(<ChatScreen />, { client: engine.client, locale: "zh" });
    await settle();
    const lines = linesOf();
    expect([lines[0], lines[2], lines.at(-1)]).toStrictEqual([
      "main 起草了这次代币发射。在你于 Telegram 中点按“开始发射”之前，不会上传或公开任何内容。",
      "简介：A cat\\u{202E} <b>on</b> the moon",
      "请在与机器人的 Telegram 对话中从此草稿开始发射；控制台只显示草稿。点按“开始发射”后，发射确认卡片会显示发射手续费、新代币和首笔买入的最少所得，你在卡片上确认。此草稿在 12:10:00 失效。",
    ]);
    expect(screen.getByRole("img", { name: "发射草稿的图片" })).toBeDefined();
  });

  it("says how a draft ended in the owner's language", async () => {
    const state: { open: object } = { open: openDraftAnswer };
    const engine = fakeClient({ ...draftAnswers, "launch/openDraft": () => state.open });
    renderSignedIn(<ChatScreen />, { client: engine.client, locale: "zh" });
    await settle();
    state.open = {};
    act(() =>
      engine.push(`chat:${agent}`, "chat/launchDraftClosed", { agent, draft, outcome: "expired" }),
    );
    await settle();
    expect(linesOf().at(-1)).toMatch(/此发射草稿已在 10 分钟后失效，没有上传任何内容。/u);
  });
});
