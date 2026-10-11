// @vitest-environment jsdom
import type { ProtocolClient } from "@binference/client";
import { type ReadyFrame, readyFrameSchema, type Scope } from "@binference/protocol";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EngineProvider } from "../connection/engine-context";
import { formatterFor, TextProvider } from "../i18n/console-text";
import { ConfirmationsScreen } from "./confirmations-screen";
import { LedgerScreen } from "./ledger-screen";
import { LimitsScreen } from "./limits-screen";

afterEach(cleanup);

const waiting = String.fromCodePoint(0x1f7e1);
const paperIcon = String.fromCodePoint(0x1f9ea);

/** One call the fake engine answered. */
interface SeenCall {
  readonly op: string;
  readonly args: object;
}

/** The answers of a fake engine, by operation. */
type FakeAnswers = Readonly<Record<string, (args: object) => object>>;

const consoleScopes: readonly Scope[] = ["read", "propose", "chat", "confirm", "loosen", "admin"];

function readyWith(scopes: readonly Scope[]): ReadyFrame {
  return readyFrameSchema.parse({
    t: "ready",
    v: 1,
    connection: "con_0190f1c2-3a4b-7c5d-8e6f-000000000001",
    scopes,
    engine: { version: "2026.10.0", protocol: 1, state: "ready" },
    owner: { locale: "en", timezone: "UTC" },
  });
}

/** A client that answers each call from `answers` and keeps every call it was given. */
function fakeClient(answers: FakeAnswers) {
  const calls: SeenCall[] = [];
  const client = {
    call: async (op: string, args: object) => {
      calls.push({ op, args });
      const answer = answers[op];
      return answer === undefined
        ? Promise.reject(Object.assign(new Error(op), { code: "protocol.unknown_op" }))
        : answer(args);
    },
    subscribe: () => () => undefined,
    status: () => ({ state: "ready" }),
  } as unknown as ProtocolClient;
  return { client, calls };
}

/** Lets React Query's timers and the answers' promises run, as the browser would between frames. */
async function settle(): Promise<void> {
  await act(async () => vi.advanceTimersByTimeAsync(10));
  await act(async () => vi.advanceTimersByTimeAsync(10));
}

/** Renders a signed-in screen in English over a fake client. */
function renderSignedIn(
  page: ReactNode,
  options: { readonly client: ProtocolClient; readonly scopes?: readonly Scope[] },
) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const link = { client: options.client, ready: readyWith(options.scopes ?? consoleScopes) };
  return render(
    <TextProvider formatter={formatterFor("en", "UTC")}>
      <QueryClientProvider client={queries}>
        <EngineProvider link={link}>{page}</EngineProvider>
      </QueryClientProvider>
    </TextProvider>,
  );
}

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
  it("draws each waiting card as Telegram does, with the Paper label", async () => {
    const { client } = fakeClient(answers);
    renderSignedIn(<ConfirmationsScreen />, { client });
    await settle();
    expect(screen.getByText(`${waiting} Confirm swap · main · ${paperIcon} Paper`)).toBeDefined();
    expect(screen.getByText("Sell 0.5 BNB → at least 312.4 USDT")).toBeDefined();
    expect(screen.getByText("Expires at 08:01:00")).toBeDefined();
    expect(screen.getByText("Paper")).toBeDefined();
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

  it("tells the owner to make an agent when there is none", async () => {
    const { client } = fakeClient({ "agent/list": () => ({ items: [] }) });
    renderSignedIn(<LimitsScreen />, { client });
    await settle();
    expect(screen.getByText(/There is no agent yet/u)).toBeDefined();
  });
});
