// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeClient } from "../testing/fake-client";
import { pluginsAnswers } from "../testing/plugins-fixture";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import { PluginsScreen } from "./plugins-screen";

afterEach(cleanup);

function itemOf(name: string): HTMLElement {
  const list = screen.getByRole("list", { name: "已安装的插件" });
  const item = within(list)
    .getAllByRole("listitem")
    .find((each) => each.parentElement === list && within(each).queryByText(name) !== null);
  if (item === undefined) {
    throw new Error(`Expected plugin ${name} in the list.`);
  }
  return item;
}

describe("the plugins screen in Chinese", () => {
  it("names each plugin's review, its state and why it is off in Chinese", async () => {
    renderSignedIn(<PluginsScreen />, { client: fakeClient(pluginsAnswers).client, locale: "zh" });
    await settle();
    expect(screen.getByRole("heading", { level: 1, name: "插件" })).toBeDefined();
    const on = itemOf("fear-index");
    expect(within(on).getByText("已启用")).toBeDefined();
    expect(within(on).getByText("社区")).toBeDefined();
    expect(within(on).getByRole("list", { name: "它可以访问 1 个主机：" })).toBeDefined();
    expect(within(on).getByRole("list", { name: "它会添加 1 个工具：" })).toBeDefined();
    expect(
      within(on).getByRole("list", {
        name: "它会读取 config.json5 中 plugins.fear-index 下的 1 项设置：",
      }),
    ).toBeDefined();
    expect(within(on).getByText("npm 来源证明：已核验")).toBeDefined();
    expect(within(on).getByText("发布者：github.com/owner/fear-index")).toBeDefined();
    expect(within(on).getByRole("button", { name: "停用" })).toBeDefined();
    const crashed = itemOf("whale-feed");
    expect(within(crashed).getByText("已停用")).toBeDefined();
    expect(
      within(crashed).getByText(
        "它在 10 分钟内崩溃了 5 次，因此 binference 已将其停止。启用它即可重新启动。",
      ),
    ).toBeDefined();
    expect(
      within(itemOf("chain-news")).getByText(
        "已暂停：binference 目前无法检查 bInference 的插件上架条目。之后会自动重新启动。",
      ),
    ).toBeDefined();
  });

  it("asks once more in Chinese before it enables a plugin", async () => {
    renderSignedIn(<PluginsScreen />, { client: fakeClient(pluginsAnswers).client, locale: "zh" });
    await settle();
    const crashed = itemOf("whale-feed");
    fireEvent.click(within(crashed).getByRole("button", { name: "启用" }));
    expect(
      within(crashed).getByText(
        "启用 whale-feed？从 Agent 的下一轮起，它的工具可供 Agent 使用；启用期间，自动模式会在每笔交易前先询问你。",
      ),
    ).toBeDefined();
    expect(within(crashed).getByRole("button", { name: "确认启用" })).toBeDefined();
    expect(within(crashed).getByRole("button", { name: "保持停用" })).toBeDefined();
  });
});
