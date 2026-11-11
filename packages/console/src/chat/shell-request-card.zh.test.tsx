// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatScreen } from "../screens/chat-screen";
import { fakeClient } from "../testing/fake-client";
import { renderSignedIn, settle } from "../testing/render-signed-in";

afterEach(cleanup);

const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const view = {
  request: "shq_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  agent,
  job: "shj_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  command: "git status",
  folder: "/srv/project",
  reason: "always",
  canAlwaysAllow: true,
  createdAt: 1,
  closesAt: 600_001,
};

describe("a shell request in the console, in Chinese", () => {
  it("shows the request and its three answers in Chinese", async () => {
    const engine = fakeClient({
      "agent/list": () => ({
        items: [{ agent, name: "main", mode: "paper", locale: "zh", createdAt: 1, changedAt: 1 }],
      }),
      "chat/messages": () => ({ items: [] }),
      "intent/list": () => ({ items: [] }),
      "chat/openQuestion": () => ({}),
      "chat/openCredentialRequest": () => ({}),
      "shell/requests": () => ({ items: [view] }),
    });
    renderSignedIn(<ChatScreen />, { client: engine.client, locale: "zh" });
    await settle();
    const card = screen.getByRole("region", { name: "命令请求" });
    expect(card.textContent).toContain("main 请求运行一条命令");
    expect(card.textContent).toContain("每条命令运行前都会询问你");
    expect(
      ["允许一次", "始终允许", "拒绝"].map(
        (name) => screen.getByRole("button", { name }).textContent,
      ),
    ).toStrictEqual(["允许一次", "始终允许", "拒绝"]);
  });
});
