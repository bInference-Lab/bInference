// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeClient } from "../testing/fake-client";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import { ruleAnswers, ruleFixture } from "../testing/rules-fixture";
import { RulesScreen } from "./rules-screen";

afterEach(cleanup);

describe("the alert rules screen in Chinese", () => {
  it("names every part of a rule and its form in the owner's language", async () => {
    const { client } = fakeClient(ruleAnswers);
    renderSignedIn(<RulesScreen />, { client, locale: "zh" });
    await settle();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("提醒规则");
    const [first] = screen.getAllByRole("listitem") as [HTMLElement];
    const rule = within(first);
    expect(rule.getByText("已生效")).toBeDefined();
    expect(rule.getByText(/每分钟最多 5 次 · 已成交 2 次，最多 10 次 · 截至/u)).toBeDefined();
    expect(rule.getByRole("button", { name: "更换地址" })).toBeDefined();
    fireEvent.click(rule.getByRole("button", { name: "删除" }));
    expect(rule.getByText("删除此规则吗？此后其地址将失效。")).toBeDefined();
  });

  it("shows a new rule's URL once with its warning in Chinese", async () => {
    const { client } = fakeClient(ruleAnswers);
    renderSignedIn(<RulesScreen />, { client, locale: "zh" });
    await settle();
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "CAKE 突破" } });
    fireEvent.change(screen.getByLabelText("代币"), { target: { value: "CAKE" } });
    fireEvent.change(screen.getByLabelText("每次成交"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "创建规则" }));
    await settle();
    expect(screen.getByText("其地址只显示这一次")).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>("提醒规则地址").value).toBe(ruleFixture.url);
    expect(screen.getByRole("button", { name: "我已复制" })).toBeDefined();
  });
});
