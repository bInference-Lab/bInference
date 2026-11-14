// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { checksAnswers, checksFixture } from "../testing/checks-fixture";
import { fakeClient } from "../testing/fake-client";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import { ChecksScreen } from "./checks-screen";

afterEach(cleanup);

describe("the checks screen in Chinese", () => {
  it("shows the report in the terminal's Chinese words", async () => {
    const engine = fakeClient(checksAnswers);
    renderSignedIn(<ChecksScreen />, { client: engine.client, locale: "zh" });
    await settle();
    expect(screen.getByRole("heading", { level: 1, name: "检查" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "运行检查" }));
    await settle();
    engine.push("job", "job/done", checksFixture.done);
    await settle();
    expect(screen.getByText("已运行 5 项检查：1 个问题，1 个警告。")).toBeDefined();
    expect(screen.getByRole("region", { name: "问题" }).textContent).toContain(
      "本机的其他账户可以打开 state/config.json5。",
    );
    expect(screen.getByRole("region", { name: "警告" })).toBeDefined();
    expect(screen.getByRole("region", { name: "供参考" })).toBeDefined();
    expect(screen.getByRole("region", { name: "其他检查" }).textContent).toContain("未检查");
    expect(screen.getByRole("button", { name: "再次运行检查" })).toBeDefined();
  });

  it("tells a connection without admin where to run the checks in Chinese", async () => {
    renderSignedIn(<ChecksScreen />, {
      client: fakeClient(checksAnswers).client,
      scopes: ["read", "chat", "confirm", "loosen"],
      locale: "zh",
    });
    await settle();
    expect(screen.getByText(/^此连接无法运行检查。/u)).toBeDefined();
  });
});
