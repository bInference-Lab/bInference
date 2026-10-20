// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLiveTopics } from "../connection/use-live-topics";
import { fakeClient } from "../testing/fake-client";
import { fixture, portfolioAnswer, portfolioAnswers } from "../testing/portfolio-fixture";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import { PortfolioScreen } from "./portfolio-screen";

afterEach(cleanup);

// A test that moves the clock puts it back.
const startedAt = Date.now();
afterEach(() => {
  vi.setSystemTime(startedAt);
});

function rowsOf(table: HTMLElement): readonly (readonly string[])[] {
  return within(table)
    .getAllByRole("row")
    .map((row) =>
      within(row)
        .queryAllByRole("cell")
        .map((cell) => cell.textContent),
    );
}

function cardTexts(list: HTMLElement): readonly (readonly string[])[] {
  return within(list)
    .getAllByRole("listitem")
    .map((item) =>
      [...item.querySelectorAll("[data-slot=card-title], p")].map((each) => each.textContent),
    );
}

// The portfolio screen, following the engine's pushes as the console's shell does.
function Followed(): React.JSX.Element {
  useLiveTopics();
  return <PortfolioScreen />;
}

describe("the portfolio screen", () => {
  it("shows live and paper in separate sections, each with its own total, never one sum", async () => {
    const { client } = fakeClient(portfolioAnswers);
    renderSignedIn(<PortfolioScreen />, { client });
    await settle();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("main · Live");
    const live = screen.getByRole("region", { name: "Live holdings" });
    const paper = screen.getByRole("region", { name: "Paper holdings" });
    expect(within(live).getByText("Live total: $420.50")).toBeDefined();
    expect(within(paper).getByText("Paper total: $1,100.00")).toBeDefined();
    expect(within(live).queryByText(/Paper/u)).toBeNull();
    expect(screen.queryByText(/\$1,520\.50/u)).toBeNull();
  });

  it("lists each wallet's balances as portfolio/get answers them", async () => {
    const { client } = fakeClient(portfolioAnswers);
    renderSignedIn(<PortfolioScreen />, { client });
    await settle();
    const live = screen.getByRole("region", { name: "Live holdings" });
    const table = within(live).getByRole("table", { name: "Wallet trading · 0x1111…2222" });
    expect(rowsOf(table)).toStrictEqual([
      [],
      ["USDT", "120.5", "$120.50"],
      ["0xabab…abab", "42000 base units", "No price now"],
      ["BNB", "0.5", "$300.00"],
    ]);
    expect(
      within(live).getByText("Holdings with no price now are left out of the total."),
    ).toBeDefined();
    const paper = screen.getByRole("region", { name: "Paper holdings" });
    expect(rowsOf(within(paper).getByRole("table"))).toStrictEqual([
      [],
      ["BNB", "1", "$600.00"],
      ["USDT", "500", "$500.00"],
    ]);
    expect(within(paper).queryByText(/no price/u)).toBeNull();
  });

  it("draws each P&L card's lines as the engine drew them, open and closed apart", async () => {
    const { client } = fakeClient(portfolioAnswers);
    renderSignedIn(<PortfolioScreen />, { client });
    await settle();
    const live = screen.getByRole("region", { name: "Live holdings" });
    expect(cardTexts(within(live).getByRole("list", { name: "Positions" }))).toStrictEqual([
      [
        "BNB · main",
        "Holding 0.5 BNB · value $300.00",
        "Average cost $550.00 · cost $275.00",
        "P&L unrealized +$25.00 (+9.09%) · realized $0.00",
        "Fees venue $1.50 · network $0.08",
        "Since Oct 3, 2026, 04:00:00",
      ],
    ]);
    expect(
      cardTexts(within(live).getByRole("list", { name: "Closed in the last 7 days" })),
    ).toStrictEqual([
      [
        "CAKE · main · closed",
        "Bought for $200.00 · sold for $180.00",
        "P&L realized -$20.00 (-10.00%)",
        "Fees venue $1.50 · network $0.08",
        "Held Oct 3, 2026, 04:00:00 → Oct 5, 2026, 04:00:00 (2 days)",
      ],
    ]);
  });

  it("marks a paper position's card with the Paper label", async () => {
    const { client } = fakeClient(portfolioAnswers);
    renderSignedIn(<PortfolioScreen />, { client });
    await settle();
    const paper = screen.getByRole("region", { name: "Paper holdings" });
    const list = within(paper).getByRole("list", { name: "Positions" });
    expect(cardTexts(list).map(([title]) => title)).toStrictEqual(["BNB · mainPaper"]);
    expect(within(paper).getByText("Nothing closed in the last 7 days.")).toBeDefined();
  });

  it("asks for the open positions and those closed in the last 7 days", async () => {
    vi.setSystemTime(1_791_600_000_000);
    const { client, calls } = fakeClient(portfolioAnswers);
    renderSignedIn(<PortfolioScreen />, { client });
    await settle();
    expect(calls.filter(({ op }) => op.startsWith("portfolio/"))).toStrictEqual([
      { op: "portfolio/get", args: { agent: fixture.agent } },
      {
        op: "portfolio/pnl",
        args: { agent: fixture.agent, from: 1_790_995_200_000, to: 1_791_600_000_000, cards: true },
      },
    ]);
  });

  it("loads the portfolio again when the ledger moves, and never on a timer", async () => {
    let paperTotal = 1_100_000_000n;
    const engine = fakeClient({
      ...portfolioAnswers,
      "portfolio/get": () => ({ ...portfolioAnswer, paperTotalUsdMicros: paperTotal }),
    });
    const { calls } = engine;
    renderSignedIn(<Followed />, { client: engine.client });
    await settle();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(calls.filter(({ op }) => op === "portfolio/get")).toHaveLength(1);
    paperTotal = 1_200_000_000n;
    engine.push("ledger", "ledger/entry", {});
    await settle();
    expect(calls.filter(({ op }) => op === "portfolio/get")).toHaveLength(2);
    expect(calls.filter(({ op }) => op === "portfolio/pnl")).toHaveLength(2);
    expect(screen.getByText("Paper total: $1,200.00")).toBeDefined();
  });

  it("says an agent holds nothing yet", async () => {
    const { client } = fakeClient({
      ...portfolioAnswers,
      "portfolio/get": () => ({ ...portfolioAnswer, balances: [], paperTotalUsdMicros: undefined }),
      "portfolio/pnl": () => ({ positions: [], realizedUsdMicros: 0n, cards: [], assets: {} }),
    });
    renderSignedIn(<PortfolioScreen />, { client });
    await settle();
    expect(screen.getByText("This agent holds nothing yet.")).toBeDefined();
    expect(screen.queryByRole("region", { name: /holdings/u })).toBeNull();
  });

  it("says there is no agent yet, with the command that makes one", async () => {
    const { client } = fakeClient({ ...portfolioAnswers, "agent/list": () => ({ items: [] }) });
    renderSignedIn(<PortfolioScreen />, { client });
    await settle();
    expect(screen.getByText("binference init").tagName).toBe("CODE");
  });

  it("shows that it loads while the engine has not answered", async () => {
    const { client } = fakeClient({
      ...portfolioAnswers,
      "portfolio/get": async () => new Promise<object>(() => undefined),
    });
    renderSignedIn(<PortfolioScreen />, { client });
    await settle();
    expect(screen.getByText("Loading").parentElement?.getAttribute("aria-busy")).toBe("true");
  });

  it("says why the portfolio could not load, in the words of its error code", async () => {
    const refused = Object.assign(new Error("scope"), { code: "auth.scope" });
    const { client } = fakeClient({
      ...portfolioAnswers,
      "portfolio/pnl": () => Promise.reject(refused),
    });
    renderSignedIn(<PortfolioScreen />, { client });
    await settle();
    expect(screen.getByRole("alert").textContent).toMatch(/^The console could not load this\./u);
  });
});
