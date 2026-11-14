// @vitest-environment jsdom
import { createFormatter } from "@binference/i18n";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useLiveTopics } from "../connection/use-live-topics";
import { wordsOf } from "../i18n/console-text";
import { fakeClient } from "../testing/fake-client";
import { orderAnswers, orderFixture } from "../testing/orders-fixture";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import { OrdersScreen } from "./orders-screen";

afterEach(cleanup);

const english = wordsOf(createFormatter({ locale: "en", timeZone: "UTC" }));
const { active, priceAlert } = orderFixture;

// The list item whose text holds `words`.
function itemWith(words: string | RegExp): HTMLElement {
  const item = screen
    .getAllByRole("listitem")
    .find((each) => within(each).queryAllByText(words).length > 0);
  if (item === undefined) {
    throw new Error(`Expected an item holding ${String(words)}.`);
  }
  return item;
}

// The orders screen, following the engine's pushes as the console's shell does.
function Followed(): React.JSX.Element {
  useLiveTopics();
  return <OrdersScreen />;
}

function opsOf(calls: readonly { readonly op: string; readonly args: object }[], op: string) {
  return calls.filter((call) => call.op === op).map(({ args }) => args);
}

describe("the auto orders screen", () => {
  it("lists the open orders of each state, live apart from paper, with the card of one that waits", async () => {
    const engine = fakeClient(orderAnswers);
    renderSignedIn(<OrdersScreen />, { client: engine.client });
    await settle();
    const live = screen.getByRole("region", { name: "Live orders" });
    const paper = screen.getByRole("region", { name: "Paper orders" });
    expect(within(live).getByText("Paused while its agent is frozen")).toBeDefined();
    expect(
      within(live).getByText(/^Trailing stop · sell CAKE · 5\.00% from the best price/u),
    ).toBeDefined();
    expect(within(live).queryByText("Active")).toBeNull();
    expect(within(paper).getByText("Active")).toBeDefined();
    expect(within(paper).getByText(/^Stop-loss · sell CAKE · at \$1\.80 · 0 fills/u)).toBeDefined();
    const waiting = itemWith("Waits for its card");
    expect(within(waiting).getByRole("button", { name: "Confirm" })).toBeDefined();
    expect(within(itemWith("Active")).queryByRole("button", { name: "Confirm" })).toBeNull();
    expect(opsOf(engine.calls, "order/list")).toStrictEqual([
      { state: "awaiting_confirmation", limit: 50 },
      { state: "active", limit: 49 },
      { state: "paused", limit: 48 },
    ]);
  });

  it("lists the orders that ended, each in its state's words", async () => {
    const engine = fakeClient(orderAnswers);
    renderSignedIn(<OrdersScreen />, { client: engine.client });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Ended" }));
    await settle();
    for (const state of ["Filled", "Cancelled", "Expired", "Ended"]) {
      expect(itemWith(state)).toBeDefined();
    }
    expect(screen.getByText(`Ended: ${english("reason.position_closed")}`)).toBeDefined();
    expect(within(itemWith("Filled")).queryByRole("button", { name: "Cancel order" })).toBeNull();
  });

  it("shows an order's fills and skips, newest first, each skip with its reason's words", async () => {
    const engine = fakeClient(orderAnswers);
    renderSignedIn(<OrdersScreen />, { client: engine.client });
    await settle();
    const item = itemWith("Active");
    fireEvent.click(within(item).getByRole("button", { name: "Fills and skips" }));
    await settle();
    const table = within(item).getByRole("table", { name: "Fills and skips of this order" });
    const outcomes = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[1]?.textContent);
    expect(outcomes).toStrictEqual([
      "Skipped: it would pass this leader's daily cap ($40.00 of $40.00 used)",
      "Skipped",
      `Skipped: ${english("reason.late")}`,
      "Filled on paper",
    ]);
    expect(within(item).getByText("Only the newest 50 show here.")).toBeDefined();
    expect(opsOf(engine.calls, "order/get")).toStrictEqual([{ order: active }]);
  });

  it("asks before it cancels an order, then shows what the engine answered", async () => {
    const engine = fakeClient(orderAnswers);
    renderSignedIn(<OrdersScreen />, { client: engine.client });
    await settle();
    const item = itemWith("Active");
    fireEvent.click(within(item).getByRole("button", { name: "Cancel order" }));
    expect(within(item).getByText(/It fills nothing more on any surface/u)).toBeDefined();
    fireEvent.click(within(item).getByRole("button", { name: "Keep it" }));
    expect(opsOf(engine.calls, "order/cancel")).toStrictEqual([]);
    fireEvent.click(within(item).getByRole("button", { name: "Cancel order" }));
    fireEvent.click(within(item).getByRole("button", { name: "Cancel now" }));
    await settle();
    expect(opsOf(engine.calls, "order/cancel")).toStrictEqual([{ order: active }]);
    expect(screen.getByRole("status").textContent).toMatch(/^Stop-loss: cancelled at /u);
  });

  it("shows the engine's refusal of a cancel in its code's words", async () => {
    const refused = Object.assign(new Error("scope"), { code: "auth.scope" });
    const engine = fakeClient({
      ...orderAnswers,
      "order/cancel": async () => Promise.reject(refused),
    });
    renderSignedIn(<OrdersScreen />, { client: engine.client, scopes: ["read", "propose"] });
    await settle();
    const item = itemWith("Active");
    fireEvent.click(within(item).getByRole("button", { name: "Cancel order" }));
    fireEvent.click(within(item).getByRole("button", { name: "Cancel now" }));
    await settle();
    expect(within(item).getByRole("alert").textContent).toBe(
      `Not done: ${english("error.auth.scope")}`,
    );
  });

  it("loads the orders again on an order's fill or skip, and on a card's move", async () => {
    const engine = fakeClient(orderAnswers);
    renderSignedIn(<Followed />, { client: engine.client });
    await settle();
    const first = opsOf(engine.calls, "order/list").length;
    engine.push("order", "order/skipped", { order: active, agent: orderFixture.agent });
    await settle();
    const afterSkip = opsOf(engine.calls, "order/list").length;
    engine.push("intent", "card/closed", { intent: orderFixture.waitingIntent });
    await settle();
    expect([afterSkip - first, opsOf(engine.calls, "order/list").length - afterSkip]).toStrictEqual(
      [3, 3],
    );
  });

  it("lists the active alerts, and asks before it deletes one", async () => {
    const engine = fakeClient(orderAnswers);
    renderSignedIn(<OrdersScreen />, { client: engine.client });
    await settle();
    const alerts = screen.getByRole("list", { name: "Active alerts" });
    const lines = within(alerts)
      .getAllByRole("listitem")
      .map((item) => within(item).getAllByText(/alert:/u)[0]?.textContent);
    expect(lines).toStrictEqual([
      "Price alert: CAKE at or above $3.00",
      "Wallet alert: each buy of 0x0000…00d1 worth at least $100.00",
      "Launch alert: each new launch that passes its filters",
    ]);
    const price = itemWith("Price alert: CAKE at or above $3.00");
    expect(within(price).getByText("Not fired yet · wakes the agent")).toBeDefined();
    fireEvent.click(within(price).getByRole("button", { name: "Delete" }));
    expect(within(price).getByText("Delete this alert now? It never fires again.")).toBeDefined();
    fireEvent.click(within(price).getByRole("button", { name: "Delete now" }));
    await settle();
    expect(opsOf(engine.calls, "alert/delete")).toStrictEqual([{ alert: priceAlert }]);
    expect(opsOf(engine.calls, "alert/list")).toHaveLength(2);
  });

  it("lets a connection without propose read orders and alerts, but not cancel or delete", async () => {
    const engine = fakeClient(orderAnswers);
    renderSignedIn(<OrdersScreen />, { client: engine.client, scopes: ["read"] });
    await settle();
    expect(screen.getByText(/can read auto orders and alerts but not cancel/u)).toBeDefined();
    expect(screen.queryByRole("button", { name: "Cancel order" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});
