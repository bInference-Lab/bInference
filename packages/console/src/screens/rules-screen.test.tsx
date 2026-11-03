// @vitest-environment jsdom
import { createFormatter } from "@binference/i18n";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { wordsOf } from "../i18n/console-text";
import { fakeClient } from "../testing/fake-client";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import { ruleAnswers, ruleFixture } from "../testing/rules-fixture";
import { RulesScreen } from "./rules-screen";

afterEach(cleanup);

const english = wordsOf(createFormatter({ locale: "en", timeZone: "UTC" }));
const { agent, active, cake, url, rotatedUrl } = ruleFixture;

function ruleCard(name: string): HTMLElement {
  const item = screen
    .getAllByRole("listitem")
    .find((each) => within(each).queryByText(name) !== null);
  if (item === undefined) {
    throw new Error(`Expected the rule ${name} in the list.`);
  }
  return item;
}

function type(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("the alert rules screen", () => {
  it("lists each rule as its card words it, and the card of one that waits", async () => {
    const { client } = fakeClient(ruleAnswers);
    renderSignedIn(<RulesScreen />, { client });
    await settle();
    const first = ruleCard("CAKE breakout");
    expect(within(first).getByText("Active")).toBeDefined();
    expect(within(first).getByText("buy CAKE with $20.00 of BNB on each alert")).toBeDefined();
    expect(within(first).getByText(/At most 5 a minute · 2 of 10 fills · until/u)).toBeDefined();
    const second = ruleCard("CAKE dip");
    expect(within(second).getByText("Waits for its card")).toBeDefined();
    expect(within(second).getByRole("button", { name: "Confirm" })).toBeDefined();
    expect(within(first).queryByRole("button", { name: "Confirm" })).toBeNull();
  });

  it("makes a rule from the form and shows its URL once, until the owner copied it", async () => {
    const engine = fakeClient(ruleAnswers);
    renderSignedIn(<RulesScreen />, { client: engine.client });
    await settle();
    type("Name", "CAKE breakout");
    type("Token", "CAKE");
    type("Each fill", "20");
    type("Alerts a minute, 1 to 60", "5");
    fireEvent.click(screen.getByRole("button", { name: "Create rule" }));
    await settle();
    const search = engine.calls.find(({ op }) => op === "asset/search");
    expect(search?.args).toStrictEqual({ chain: "eip155:56", query: "CAKE", agent });
    const created = engine.calls.find(({ op }) => op === "webhookRule/create");
    expect(created?.args).toStrictEqual({
      agent,
      name: "CAKE breakout",
      token: cake,
      side: "buy",
      size: { usdMicros: 20_000_000n },
      ratePerMinute: 5,
    });
    expect(screen.getByText("Its URL, shown this once")).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe("");
    expect(screen.getByLabelText<HTMLInputElement>("Alert rule URL").value).toBe(url);
    fireEvent.click(screen.getByRole("button", { name: "I copied it" }));
    await settle();
    expect(screen.queryByText(url)).toBeNull();
    expect(screen.queryByLabelText("Alert rule URL")).toBeNull();
  });

  it("stores nothing for a token it cannot find or a size it cannot read", async () => {
    const engine = fakeClient(ruleAnswers);
    renderSignedIn(<RulesScreen />, { client: engine.client });
    await settle();
    type("Name", "Mystery");
    type("Token", "NOPE");
    type("Each fill", "20");
    fireEvent.click(screen.getByRole("button", { name: "Create rule" }));
    await settle();
    expect(screen.getByText(/No token matches NOPE\./u)).toBeDefined();
    type("Token", "CAKE");
    type("Each fill", "twenty");
    fireEvent.click(screen.getByRole("button", { name: "Create rule" }));
    await settle();
    expect(screen.getByText(/Each fill takes a number above zero/u)).toBeDefined();
    expect(engine.calls.filter(({ op }) => op === "webhookRule/create")).toStrictEqual([]);
  });

  it("asks before it rotates a URL, then shows the new one once", async () => {
    const engine = fakeClient(ruleAnswers);
    renderSignedIn(<RulesScreen />, { client: engine.client });
    await settle();
    const first = ruleCard("CAKE breakout");
    fireEvent.click(within(first).getByRole("button", { name: "Rotate URL" }));
    expect(within(first).getByText(/The old one no longer works from then on/u)).toBeDefined();
    expect(engine.calls.filter(({ op }) => op === "webhookRule/rotateUrl")).toStrictEqual([]);
    fireEvent.click(within(first).getByRole("button", { name: "Rotate now" }));
    await settle();
    expect(engine.calls.filter(({ op }) => op === "webhookRule/rotateUrl")).toStrictEqual([
      { op: "webhookRule/rotateUrl", args: { rule: active } },
    ]);
    expect(within(first).getByLabelText<HTMLInputElement>("Alert rule URL").value).toBe(rotatedUrl);
  });

  it("asks before it deletes a rule, and keeps it when the owner keeps it", async () => {
    const engine = fakeClient(ruleAnswers);
    renderSignedIn(<RulesScreen />, { client: engine.client });
    await settle();
    const first = ruleCard("CAKE breakout");
    fireEvent.click(within(first).getByRole("button", { name: "Delete" }));
    fireEvent.click(within(first).getByRole("button", { name: "Keep it" }));
    fireEvent.click(within(first).getByRole("button", { name: "Delete" }));
    fireEvent.click(within(first).getByRole("button", { name: "Delete now" }));
    await settle();
    expect(engine.calls.filter(({ op }) => op === "webhookRule/delete")).toStrictEqual([
      { op: "webhookRule/delete", args: { rule: active } },
    ]);
  });

  it("shows what became of each alert, never its body", async () => {
    const engine = fakeClient(ruleAnswers);
    renderSignedIn(<RulesScreen />, { client: engine.client });
    await settle();
    const first = ruleCard("CAKE breakout");
    fireEvent.click(within(first).getByRole("button", { name: "Alerts" }));
    await settle();
    const table = within(first).getByRole("table", { name: "Alerts to CAKE breakout" });
    const outcomes = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole("cell")
          .slice(1)
          .map((cell) => cell.textContent),
      );
    expect(outcomes).toStrictEqual([
      ["Over the rule's rate, recorded only", "breakout-4"],
      ["A repeat of an alert before it, recorded only", ""],
      [`Skipped: ${english("reason.late")}`, ""],
      ["Filled on paper", "breakout-1"],
    ]);
    expect(engine.calls.find(({ op }) => op === "webhookRule/events")?.args).toStrictEqual({
      rule: active,
      limit: 20,
    });
  });

  it("lets a connection without admin read rules, but not make or rotate one", async () => {
    const { client } = fakeClient(ruleAnswers);
    renderSignedIn(<RulesScreen />, { client, scopes: ["read", "confirm"] });
    await settle();
    expect(screen.queryByRole("button", { name: "Create rule" })).toBeNull();
    expect(screen.getByText(/can read alert rules but not make or rotate them/u)).toBeDefined();
    expect(
      within(ruleCard("CAKE breakout")).queryByRole("button", { name: "Rotate URL" }),
    ).toBeNull();
    expect(within(ruleCard("CAKE breakout")).getByRole("button", { name: "Delete" })).toBeDefined();
  });
});
