// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConsoleRoutes } from "../app/console-router";
import type { BrowserPush } from "../push/browser-push";
import { ConsolePushProvider } from "../push/console-push";
import { fakeClient } from "../testing/fake-client";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import { ConfirmationsScreen } from "./confirmations-screen";
import { LedgerScreen } from "./ledger-screen";
import { LimitsScreen } from "./limits-screen";

afterEach(cleanup);

// A test that moves the clock puts it back, so the cards of the next one have not expired.
const startedAt = Date.now();
afterEach(() => {
  vi.setSystemTime(startedAt);
});

const waiting = String.fromCodePoint(0x1f7e1);
const paperIcon = String.fromCodePoint(0x1f9ea);

const bnb = "eip155:56/slip44:714";
const usdt = "eip155:56/erc20:0x55d398326f99059fF775485246999027B3197955";
const intent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const card = "crd_0190f1c2-3a4b-7c5d-8e6f-000000000001";

const pending = {
  items: [{ intent, agent: "agt_1", kind: "swap", paper: true, card: { card, version: 2 } }],
};
const lines = {
  card,
  version: 2,
  expiresAt: 1_800_000_060_000,
  assets: {
    [bnb]: { symbol: "BNB", name: "BNB", decimals: 18, verified: true },
    [usdt]: { symbol: "USDT", name: "Tether USD", decimals: 18, verified: true },
  },
  lines: [
    {
      key: "card.header",
      values: {
        action: { type: "choice", choice: "swap" },
        agent: { type: "text", text: "main" },
        mode: { type: "choice", choice: "paper" },
      },
    },
    {
      key: "card.swap.action",
      values: {
        in: { type: "amount", amount: { asset: bnb, base: 5n * 10n ** 17n } },
        minOut: { type: "amount", amount: { asset: usdt, base: 3124n * 10n ** 17n } },
      },
    },
    { key: "card.expiry", values: { time: { type: "time", atMs: 1_800_000_060_000 } } },
  ],
};

const answers = {
  "intent/list": () => pending,
  "intent/card": () => lines,
  "intent/confirm": () => ({ intent, state: "paper_filled" }),
  "intent/deny": () => ({ intent, state: "denied" }),
};

describe("the confirmations screen", () => {
  it("draws each waiting card as Telegram does, its status icons as line icons", async () => {
    const { client } = fakeClient(answers);
    const { container } = renderSignedIn(<ConfirmationsScreen />, { client });
    await settle();
    const title = container.querySelector("[data-slot=card-title]");
    // The waiting icon's name is read to screen readers; the Paper label alone marks the mode.
    expect(title?.textContent).toBe("Waiting Confirm swap · mainPaper");
    expect(title?.textContent).not.toMatch(new RegExp(`${waiting}|${paperIcon}`, "u"));
    expect(title?.querySelectorAll("svg[aria-hidden=true]")).toHaveLength(1);
    expect(screen.getByText("Sell 0.5 BNB → at least 312.4 USDT")).toBeDefined();
    expect(screen.getByText("Expires at 08:01:00")).toBeDefined();
    // Only the Paper label: the console's header leaves the mode out.
    expect(screen.getAllByText("Paper")).toHaveLength(1);
  });

  it("counts down the card's time left, then disables Confirm once it expired", async () => {
    vi.setSystemTime(lines.expiresAt - 42_000);
    const { client } = fakeClient(answers);
    renderSignedIn(<ConfirmationsScreen />, { client });
    await settle();
    expect(screen.getByRole("timer").textContent).toBe("42 seconds left");
    await act(async () => vi.advanceTimersByTimeAsync(41_000));
    expect(screen.getByRole("timer").textContent).toBe("1 second left");
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.getByRole("timer").textContent).toBe("Expired");
    expect(screen.getByRole("button", { name: "Confirm" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(false);
  });

  it("says a trade has no time limit, its warning icon drawn as a line icon", async () => {
    const [header, action, expiry] = lines.lines;
    const untimed = {
      ...lines,
      lines: [header, action, { key: "card.warn.noDeadline", values: {} }, expiry],
    };
    const { client } = fakeClient({ ...answers, "intent/card": () => untimed });
    renderSignedIn(<ConfirmationsScreen />, { client });
    await settle();
    const warning = screen.getByText(
      "This trade has no time limit: if it is delayed, it can still fill later, never below the minimum received",
    );
    expect(warning.parentElement?.textContent).toMatch(/^Warning This trade has no time limit/u);
  });

  it("says why auto mode asks, in the words of its reason", async () => {
    const [header, action, expiry] = lines.lines;
    const why = { key: "autoAsks.spender", values: {} };
    const asked = {
      ...lines,
      lines: [
        header,
        action,
        { key: "card.warn.autoAsks", values: { why: { type: "line", line: why } } },
        expiry,
      ],
    };
    const { client } = fakeClient({ ...answers, "intent/card": () => asked });
    renderSignedIn(<ConfirmationsScreen />, { client });
    await settle();
    expect(
      screen.getByText("Auto mode asks you here: it approves a contract that is not verified"),
    ).toBeDefined();
  });

  it("draws the same line in the Mini App, under its own path", async () => {
    const [header, action, expiry] = lines.lines;
    const why = { key: "autoAsks.overCap", values: {} };
    const asked = {
      ...lines,
      lines: [
        header,
        action,
        { key: "card.warn.autoAsks", values: { why: { type: "line", line: why } } },
        expiry,
      ],
    };
    const { client } = fakeClient({ ...answers, "intent/card": () => asked });
    // The router restores the scroll on each page, which jsdom does not lay out.
    const scroll = vi.spyOn(globalThis, "scrollTo").mockImplementation(() => undefined);
    globalThis.history.replaceState(null, "", "/mini");
    renderSignedIn(<ConsoleRoutes basepath="/mini" />, { client });
    await settle();
    expect(screen.getByText("Auto mode asks you here: over your auto caps")).toBeDefined();
    globalThis.history.replaceState(null, "", "/");
    scroll.mockRestore();
  });

  it("names a token the registry does not list by what it answered, with its short address", async () => {
    const xvs = "eip155:56/erc20:0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63";
    const [header, , expiry] = lines.lines;
    const amount = { asset: xvs, base: 2n * 10n ** 18n };
    const buy = {
      ...lines,
      assets: {
        ...lines.assets,
        [xvs]: { symbol: "XVS", name: "Venus", decimals: 18, verified: false },
      },
      lines: [
        header,
        {
          key: "card.swap.action",
          values: {
            in: lines.lines[1]?.values.in,
            minOut: { type: "amount", amount },
          },
        },
        expiry,
      ],
    };
    const { client } = fakeClient({ ...answers, "intent/card": () => buy });
    renderSignedIn(<ConfirmationsScreen />, { client });
    await settle();
    expect(screen.getByText("Sell 0.5 BNB → at least 2 XVS (0xcF6B…6C63)")).toBeDefined();
  });

  it("confirms the card version it shows", async () => {
    const { client, calls } = fakeClient(answers);
    renderSignedIn(<ConfirmationsScreen />, { client });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await settle();
    expect(calls).toContainEqual({ op: "intent/confirm", args: { intent, card, cardVersion: 2 } });
  });

  it("cancels the card", async () => {
    const { client, calls } = fakeClient(answers);
    renderSignedIn(<ConfirmationsScreen />, { client });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await settle();
    expect(calls).toContainEqual({ op: "intent/deny", args: { intent, card } });
  });

  it("says why a Confirm was refused, in the words of its error code", async () => {
    const refused = Object.assign(new Error("cap"), { code: "intent.card_changed" });
    const { client } = fakeClient({ ...answers, "intent/confirm": () => Promise.reject(refused) });
    renderSignedIn(<ConfirmationsScreen />, { client });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await settle();
    expect(screen.getByRole("alert").textContent).toMatch(/^Not answered: /u);
  });

  it("shows no buttons to a connection without the confirm scope", async () => {
    const { client } = fakeClient(answers);
    renderSignedIn(<ConfirmationsScreen />, { client, scopes: ["read"] });
    await settle();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("This connection can read cards but not answer them.")).toBeDefined();
  });

  it("says nothing waits when no card is open", async () => {
    const { client } = fakeClient({ ...answers, "intent/list": () => ({ items: [] }) });
    renderSignedIn(<ConfirmationsScreen />, { client });
    await settle();
    expect(screen.getByText("Nothing waits for your confirmation.")).toBeDefined();
  });
});

// The VAPID public key of RFC 8292's worked example, and a browser that has not subscribed yet.
const engineKey =
  "BA1Hxzyi1RUM1b5wjxsn7nGxAszw2u61m164i3MrAIxHF6YK5h4SDYic-dRuU_RCPCfA5aq9ojSwk5Y2EmClBPs";
const unsubscribed: BrowserPush = {
  permission: () => "default",
  requestPermission: async () => "granted",
  manager: async () =>
    ({
      getSubscription: async () => null,
      subscribe: async () => ({
        endpoint: "https://push.example.invalid/send/a",
        getKey: () => new Uint8Array(16).buffer,
      }),
    }) as unknown as PushManager,
};

const pushAnswers = {
  ...answers,
  "webPush/status": () => ({ publicKey: engineKey, registered: false }),
  "webPush/register": () => ({}),
};

const scrolled: Element[] = [];

function recordScroll(this: Element): void {
  scrolled.push(this);
}

describe("browser notifications on the confirmations screen", () => {
  beforeEach(() => {
    // jsdom lays nothing out, so it has no scrollIntoView of its own.
    Element.prototype.scrollIntoView = recordScroll;
  });

  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    scrolled.splice(0);
  });

  it("turns them on: the browser subscribes and the engine registers it", async () => {
    const { client, calls } = fakeClient(pushAnswers);
    const page = (
      <ConsolePushProvider value={{ push: unsubscribed }}>
        <ConfirmationsScreen />
      </ConsolePushProvider>
    );
    renderSignedIn(page, { client });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Allow notifications" }));
    await settle();
    expect(calls.map((call) => call.op)).toContain("webPush/register");
    expect(screen.getByText("This browser gets a notification when a card waits.")).toBeDefined();
  });

  it("shows no notification setting where the browser has no push", async () => {
    const { client } = fakeClient(pushAnswers);
    renderSignedIn(<ConfirmationsScreen />, { client });
    await settle();
    expect(screen.queryByRole("button", { name: "Allow notifications" })).toBeNull();
  });

  it("brings the card a notification opened into view", async () => {
    const { client } = fakeClient(pushAnswers);
    const page = (
      <ConsolePushProvider value={{ focus: intent }}>
        <ConfirmationsScreen />
      </ConsolePushProvider>
    );
    renderSignedIn(page, { client });
    await settle();
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0]?.getAttribute("data-slot")).toBe("card");
  });
});

const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const hash = "0".repeat(64);

function entry(seq: number, kind: string, data: object) {
  return {
    seq,
    entry: `led_${String(seq)}`,
    at: 1_800_000_000_000 + seq * 1_000,
    agent,
    kind,
    subject: "int_0190f1c2-3a4b-7c5d-8e6f-000000000001",
    data,
    prevHash: hash,
    hash,
  };
}

// A ledger of `length` entries: odd ones paper fills, even ones live confirmations.
function ledgerAnswers(length: number) {
  const all = Array.from({ length }, (_, index) =>
    index % 2 === 0
      ? entry(index + 1, "paper_filled", { paper: true })
      : entry(index + 1, "confirmed", {}),
  );
  return {
    "ledger/list": (args: object) => {
      const { cursor, limit } = args as { readonly cursor: string; readonly limit: number };
      return { items: all.slice(Number(cursor), Number(cursor) + limit) };
    },
    "agent/list": () => ({ items: [{ agent, name: "main", mode: "paper" }] }),
  };
}

describe("the ledger screen", () => {
  it("shows the newest entries first, with the Paper label on each paper entry", async () => {
    const { client } = fakeClient(ledgerAnswers(3));
    renderSignedIn(<LedgerScreen />, { client });
    await settle();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[2]?.textContent)).toStrictEqual([
      "Paper fillPaper",
      "Confirmed",
      "Paper fillPaper",
    ]);
    expect(within(rows[0] as HTMLElement).getByText("main")).toBeDefined();
  });

  it("loads older entries a page at a time", async () => {
    const { client } = fakeClient(ledgerAnswers(70));
    renderSignedIn(<LedgerScreen />, { client });
    await settle();
    expect(screen.getAllByRole("row")).toHaveLength(51);
    fireEvent.click(screen.getByRole("button", { name: "Show older entries" }));
    await settle();
    expect(screen.getAllByRole("row")).toHaveLength(71);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says so when the ledger is empty", async () => {
    const { client } = fakeClient(ledgerAnswers(0));
    renderSignedIn(<LedgerScreen />, { client });
    await settle();
    expect(screen.getByText("The ledger has no entries yet.")).toBeDefined();
  });
});

const limits = {
  agent,
  changedAt: 1_800_000_000_000,
  perTradeUsdMicros: 50_000_000n,
  rollingDayUsdMicros: 200_000_000n,
  slippageRegistryBps: 50,
  cardTradeExpirySeconds: 60,
  venues: ["pancakeswap"],
  allowTokens: [],
  gasReserve: { "eip155:56": 5n * 10n ** 15n },
  pending: { changes: { perTradeUsdMicros: 100_000_000n }, effectiveAt: 1_800_086_400_000 },
};

describe("the limits screen", () => {
  it("shows each agent's limits in effect and the looser ones that wait", async () => {
    const { client } = fakeClient({
      "agent/list": () => ({ items: [{ agent, name: "main", mode: "paper" }] }),
      "limit/get": () => limits,
    });
    renderSignedIn(<LimitsScreen />, { client });
    await settle();
    expect(screen.getByText("main · Paper")).toBeDefined();
    expect(
      screen.getAllByText("Per-trade cap").map((cell) => cell.nextSibling?.textContent),
    ).toStrictEqual(["$50.00", "$100.00"]);
    expect(screen.getByText("60 seconds")).toBeDefined();
    expect(screen.getByText("every token that passes the risk check")).toBeDefined();
    expect(screen.getByText(/^Looser limits that apply at/u)).toBeDefined();
  });

  it("names the agent's launch wallet beside its limits", async () => {
    const launchWallet = {
      wallet: "wal_0190f1c2-3a4b-7c5d-8e6f-0000000000d2",
      agent,
      address: "eip155:56:0x6B175474E89094C44Da98b954EedeAC495271d0F",
      label: "curves",
      createdAt: 1_800_000_000_000,
      role: "launch",
    };
    const { client } = fakeClient({
      "agent/list": () => ({ items: [{ agent, name: "main", mode: "live", launchWallet }] }),
      "limit/get": () => limits,
    });
    renderSignedIn(<LimitsScreen />, { client });
    await settle();
    expect(
      screen.getByText(
        "Launch wallet curves, at 0x6B175474E89094C44Da98b954EedeAC495271d0F: trades on a launch's own curve run from it alone.",
      ),
    ).toBeDefined();
  });

  it("tells the owner to make an agent when there is none", async () => {
    const { client } = fakeClient({ "agent/list": () => ({ items: [] }) });
    renderSignedIn(<LimitsScreen />, { client });
    await settle();
    expect(screen.getByText(/There is no agent yet/u)).toBeDefined();
  });
});
