// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeClient } from "../testing/fake-client";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import {
  agentList,
  cardAnswers,
  mainFrozen,
  rescueWaiting,
  safetyFixture,
  unfreezeWaiting,
} from "../testing/safety-fixture";
import { SafetyScreen } from "./safety-screen";

afterEach(cleanup);

const { scout, unfreezeIntent, rescueIntent } = safetyFixture;

function engineWith(status: object) {
  const waiting: object[] = [];
  return fakeClient({
    "safety/status": () => status,
    "agent/list": () => agentList,
    "intent/list": () => ({ items: waiting }),
    "safety/freeze": () => ({ frozenAt: safetyFixture.frozenAt }),
    "safety/unfreeze": () => {
      waiting.push(unfreezeWaiting);
      return { intent: unfreezeIntent };
    },
    "safety/rescue": () => {
      waiting.push(rescueWaiting);
      return { intent: rescueIntent };
    },
    ...cardAnswers,
  });
}

describe("the safety screen in Chinese", () => {
  it("asks before a freeze and opens the unfreeze card in the owner's language", async () => {
    const engine = engineWith(mainFrozen);
    renderSignedIn(<SafetyScreen />, { client: engine.client, locale: "zh" });
    await settle();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("安全");
    const agents = within(screen.getByRole("list", { name: "Agent" }));
    expect(agents.getByText("未冻结")).toBeDefined();
    fireEvent.click(agents.getByRole("button", { name: "冻结 scout" }));
    expect(
      screen.getByText(/^立即冻结 scout？它已打开的卡片和未签名的操作都会取消/u),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "立即冻结" }));
    await settle();
    expect(engine.calls.filter(({ op }) => op === "safety/freeze")).toStrictEqual([
      { op: "safety/freeze", args: { agent: scout } },
    ]);
    expect(screen.getByText(/^已冻结，自 .+ 起。所有界面都会收到通知。$/u)).toBeDefined();

    fireEvent.click(agents.getByRole("button", { name: "解除冻结 main" }));
    await settle();
    expect(screen.getByText(/^解除冻结卡片在下方等待。/u)).toBeDefined();
    const card = within(screen.getByRole("region", { name: "解除冻结卡片" }));
    expect(card.getByText("对 main 解除冻结：它可以在交易限额内再次交易")).toBeDefined();
    expect(card.getByRole("button", { name: "确认" })).toBeDefined();
  });

  it("names the breaker and the rescue address in Chinese, and opens the rescue card", async () => {
    const engine = engineWith({ ...mainFrozen, breaker: { pulledAt: safetyFixture.frozenAt } });
    renderSignedIn(<SafetyScreen />, { client: engine.client, locale: "zh" });
    await settle();
    expect(screen.getByText(/^bInference 已拉下熔断开关，全部 Agent 均已冻结/u)).toBeDefined();
    expect(screen.queryByRole("button", { name: /^解除冻结/u })).toBeNull();
    expect(screen.getByText("被 bInference 的熔断开关冻结")).toBeDefined();
    const rescue = within(screen.getByRole("region", { name: "紧急转出" }));
    expect(rescue.getByText(safetyFixture.rescueAddress).parentElement?.textContent).toBe(
      `当前生效的紧急转出地址：${safetyFixture.rescueAddress}`,
    );
    fireEvent.click(rescue.getByRole("button", { name: "打开紧急转出卡片" }));
    await settle();
    const card = within(screen.getByRole("region", { name: "紧急转出卡片" }));
    expect(card.getByText(/^将全部资产转到你的紧急转出地址 0x3043…DBcB/u)).toBeDefined();
  });
});
