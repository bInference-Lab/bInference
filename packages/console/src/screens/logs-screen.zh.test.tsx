// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeClient } from "../testing/fake-client";
import { logsAnswers } from "../testing/logs-fixture";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import { LogsScreen } from "./logs-screen";

afterEach(cleanup);

describe("the logs screen in Chinese", () => {
  it("names the levels, the lines left out and the reload in Chinese", async () => {
    renderSignedIn(<LogsScreen />, { client: fakeClient(logsAnswers).client, locale: "zh" });
    await settle();
    expect(screen.getByRole("heading", { level: 1, name: "日志" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Info 及以上" }).ariaPressed).toBe("true");
    expect(screen.getByRole("button", { name: "警告和错误" })).toBeDefined();
    expect(screen.getByRole("button", { name: "重新加载" })).toBeDefined();
    expect(screen.getByRole("list", { name: "日志行" })).toBeDefined();
    expect(screen.getByText("有 2 行不是日志的 JSON 格式，因此未显示。")).toBeDefined();
  });

  it("tells a connection without admin where to read the logs in Chinese", async () => {
    renderSignedIn(<LogsScreen />, {
      client: fakeClient(logsAnswers).client,
      scopes: ["read", "chat", "confirm", "loosen"],
      locale: "zh",
    });
    await settle();
    expect(screen.getByText(/^此连接无法读取引擎日志。/u)).toBeDefined();
  });
});
