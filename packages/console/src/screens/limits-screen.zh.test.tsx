// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { type FakeAnswers, fakeClient } from "../testing/fake-client";
import { higherDayCap, limitsAgents, limitsFixture, limitsWith } from "../testing/limits-fixture";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import { LimitsScreen } from "./limits-screen";

afterEach(cleanup);

function renderChinese(answers: FakeAnswers) {
  const engine = fakeClient({
    "agent/list": () => limitsAgents,
    "limit/get": () => limitsWith(higherDayCap),
    ...answers,
  });
  renderSignedIn(<LimitsScreen />, { client: engine.client, locale: "zh" });
  return engine;
}

// Raises main's 24-hour cap to $400 in its form.
function raiseDayCap(): void {
  const form = within(screen.getByRole("form", { name: "修改 main 的限额" }));
  fireEvent.change(form.getByLabelText("限额"), { target: { value: "rollingDayUsdMicros" } });
  fireEvent.change(form.getByLabelText("新值"), { target: { value: "400" } });
  fireEvent.click(form.getByRole("button", { name: "修改限额" }));
}

describe("the limits screen's changes in Chinese", () => {
  it("names the wait of a looser limit and its cancel in the owner's language", async () => {
    const engine = renderChinese({
      "limit/set": () => limitsWith(higherDayCap),
      "limit/cancelPending": () => limitsWith(),
    });
    await settle();
    expect(screen.getByText("以美元计，例如 50")).toBeDefined();
    raiseDayCap();
    await settle();
    expect(
      screen.getByText(/^24 小时上限将于 .+ 变为 \$400\.00。所有界面都会收到通知/u),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "取消更宽松的限额" }));
    await settle();
    expect(engine.calls.filter(({ op }) => op === "limit/cancelPending")).toStrictEqual([
      { op: "limit/cancelPending", args: { agent: limitsFixture.agent } },
    ]);
    expect(
      screen.getByText("已取消更宽松的限额，当前生效的限额保持不变。所有界面都会收到通知。"),
    ).toBeDefined();
  });

  it("says what a refused change answers in the owner's language", async () => {
    const refused = Object.assign(new Error("limit/set"), { code: "limit.over_ceiling" });
    renderChinese({
      "limit/set": () => {
        throw refused;
      },
    });
    await settle();
    raiseDayCap();
    await settle();
    expect(screen.getByText(/^未修改：此限额超过了钱包的上限。/u)).toBeDefined();
  });
});
