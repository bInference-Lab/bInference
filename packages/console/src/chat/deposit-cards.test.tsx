// @vitest-environment jsdom
import { qrModules } from "@binference/qr";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatScreen } from "../screens/chat-screen";
import { fakeClient } from "../testing/fake-client";
import { renderSignedIn, settle } from "../testing/render-signed-in";

afterEach(cleanup);

const agent = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const session = "ses_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const turn = "trn_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const address = "0x52908400098527886E0F7030069857D2E4169EE7";
const launchAddress = "0x8617E340B3D01FA5F11F306F4090FD50E238070D";
const main = {
  wallet: "wal_0190f1c2-3a4b-7c5d-8e6f-000000000010",
  agent,
  address: `eip155:56:${address}`,
  chainName: "BNB Smart Chain",
  explorerLink: `https://bscscan.com/address/${address}`,
  label: "Main",
  createdAt: 1,
};
// A launch wallet from an older engine, which names neither its chain nor its page.
const launch = {
  wallet: "wal_0190f1c2-3a4b-7c5d-8e6f-000000000011",
  agent,
  address: `eip155:56:${launchAddress}`,
  label: "Launch <b>",
  createdAt: 2,
  role: "launch",
};
const paper = `Paper mode: deposits are real money and stay in this wallet until you switch the agent to live.`;
const frozen = "Frozen: deposits arrive, but the agent trades nothing until you unfreeze it.";

function chatAnswers() {
  return {
    "agent/list": () => ({
      items: [{ agent, name: "main", mode: "paper", locale: "en", createdAt: 1, changedAt: 1 }],
    }),
    "chat/messages": () => ({ items: [] }),
    "intent/list": () => ({ items: [] }),
    "chat/openQuestion": () => ({}),
  };
}

// The modules a code's path draws dark, read back from its unit squares.
function drawnModules(figure: HTMLElement, size: number): readonly (readonly boolean[])[] {
  const path = figure.querySelector("path")?.getAttribute("d") ?? "";
  const grid = Array.from({ length: size }, () => Array.from({ length: size }, () => false));
  [...path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/gu)].forEach(([, x, y, length]) => {
    const row = grid[Number(y)] ?? [];
    Array.from({ length: Number(length) }, (_, step) => Number(x) + step).forEach((at) => {
      row[at] = true;
    });
  });
  return grid;
}

async function showDeposit(wallets: readonly object[], state: object): Promise<void> {
  const engine = fakeClient(chatAnswers());
  renderSignedIn(<ChatScreen />, { client: engine.client });
  await settle();
  const topic = `chat:${agent}` as const;
  act(() => engine.push(topic, "chat/turnStarted", { agent, session, turn }));
  act(() => engine.push(topic, "chat/deposit", { agent, turn, ...state, wallets }));
}

describe("the wallets the agent showed to fund, in the chat", () => {
  it("shows a card per wallet in Telegram's words, and the turn goes on", async () => {
    await showDeposit([main, launch], { mode: "paper", frozen: true });
    const list = screen.getByRole("list", { name: "Addresses to fund main" });
    const cards = within(list).getAllByRole("region");
    expect(cards.map((card) => card.getAttribute("aria-label"))).toStrictEqual([
      "Main · agent wallet",
      "Launch <b> · launch wallet",
    ]);
    const first = screen.getByRole("region", { name: "Main · agent wallet" });
    const second = screen.getByRole("region", { name: "Launch <b> · launch wallet" });
    expect(first.textContent).toBe(
      [
        "Main · agent wallet",
        `QR code of ${address}`,
        address,
        "Copy address",
        "Send only BNB Smart Chain assets here. Assets sent on any other network can be lost.",
        `Paper ${paper}`,
        frozen,
        "View on bscscan.com",
      ].join(""),
    );
    const link = within(first).getByRole("link", { name: "View on bscscan.com" });
    expect(link.getAttribute("href")).toBe(`https://bscscan.com/address/${address}`);
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    // An older engine's wallet keeps its chain's id and shows no link; the label stays text.
    expect(second.textContent).toContain("Send only eip155:56 assets here.");
    expect(within(second).queryByRole("link")).toBeNull();
    expect(second.querySelector("b")).toBeNull();
    expect(screen.getByText("Working on it · 0 s")).toBeDefined();
  });

  it("names the breaker's hold on the card in the place of a freeze", async () => {
    await showDeposit([main], { mode: "live", frozen: true, breaker: true });
    const card = screen.getByRole("region", { name: "Main · agent wallet" });
    expect(card.textContent).toContain(
      "Held by bInference's breaker: deposits arrive and stay in this wallet, but the agent trades nothing until bInference lifts it.",
    );
    expect(card.textContent).not.toContain(frozen);
  });

  it("draws the address's QR code from its module grid, ink on white in both themes", async () => {
    await showDeposit([main], { mode: "live", frozen: false });
    const figure = screen.getByRole("figure", { name: `QR code of ${address}` });
    const modules = qrModules(address);
    expect(figure.querySelector("svg")?.getAttribute("viewBox")).toBe(
      `0 0 ${String(modules.length)} ${String(modules.length)}`,
    );
    expect(drawnModules(figure, modules.length)).toStrictEqual(modules);
    expect(figure.querySelector("rect")?.getAttribute("fill")).toBe("var(--qr-light)");
    expect(figure.querySelector("path")?.getAttribute("fill")).toBe("var(--qr-dark)");
    const card = screen.getByRole("region", { name: "Main · agent wallet" });
    expect(card.textContent).not.toContain(paper);
    expect(card.textContent).not.toContain(frozen);
  });

  it("copies the address the engine read, and says it did", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await showDeposit([main], { mode: "live", frozen: false });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy address" }));
      return Promise.resolve();
    });
    expect(writeText.mock.calls).toStrictEqual([[address]]);
    expect(screen.getByText("Address copied")).toBeDefined();
  });

  it("gives a wallet nothing runs from no code, and says to send it nothing", async () => {
    await showDeposit([{ ...launch, extra: true }], { mode: "live", frozen: false });
    const card = screen.getByRole("region", { name: "Launch <b> · extra launch wallet" });
    expect(within(card).queryByRole("figure")).toBeNull();
    expect(card.textContent).toContain("Nothing runs from this wallet. Send it no funds.");
    expect(card.textContent).not.toContain("Send only");
  });
});
