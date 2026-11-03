// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fakeClient } from "../testing/fake-client";
import { closingAnswers, receiptLines } from "../testing/receipt-fixture";
import { renderSignedIn, settle } from "../testing/render-signed-in";
import { ConfirmationsScreen } from "./confirmations-screen";

afterEach(cleanup);

async function confirmedWith(receipt: object): Promise<HTMLElement> {
  const engine = fakeClient(closingAnswers(receipt));
  renderSignedIn(<ConfirmationsScreen />, { client: engine.client });
  await settle();
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await settle();
  return screen.getByRole("region", { name: "Closed since you opened this page" });
}

describe("a closed card on the confirmations screen", () => {
  it("keeps the card's lines and shows its receipt in place of its buttons", async () => {
    const closed = await confirmedWith(receiptLines.paper);
    expect(screen.getByText("Nothing waits for your confirmation.")).toBeDefined();
    expect(within(closed).getByText("Sell 0.5 BNB → at least 312.4 USDT")).toBeDefined();
    expect(within(closed).queryAllByRole("button")).toStrictEqual([]);
    expect(within(closed).queryByRole("timer")).toBeNull();
    expect(within(closed).getByText("Paper fill: 0.5 BNB → 312.5 USDT")).toBeDefined();
  });

  it.each([
    ["filled", "Passed Done: 0.5 BNB → 312.5 USDT · https://bscscan.com/tx/0xabab"],
    ["landed", "Passed Done on chain · https://bscscan.com/tx/0xabab"],
    [
      "launched",
      "Passed Launched USDT: first buy 0.5 BNB → 312.5 USDT · https://bscscan.com/tx/0xabab",
    ],
    [
      "bridgeSent",
      "Passed Left BNB Smart Chain · arrives on Base in about 2 min · https://bscscan.com/tx/0xabab",
    ],
    [
      "bridgeDelivered",
      "Passed Delivered on Base: 0x4444…0001 received 50 USDT · https://bscscan.com/tx/0xabab",
    ],
    [
      "bridgeRefunded",
      "Warning Not delivered: Relay paid 50 USDT back to main · https://bscscan.com/tx/0xabab",
    ],
    [
      "unstaked",
      "Passed Unstaked 1 BNB: claim it from Jan 22, 2027, 08:00:00 · https://bscscan.com/tx/0xabab",
    ],
    [
      "identity",
      "Passed Registered as agent 42 in the ERC-8004 identity registry · https://bscscan.com/tx/0xabab",
    ],
    ["denied", "Refused Cancelled on Telegram"],
  ] as const)("shows a %s receipt as Telegram does", async (kind, line) => {
    const closed = await confirmedWith(receiptLines[kind]);
    const footer = closed.querySelector("[data-slot=card-footer]");
    expect(footer?.textContent).toBe(line);
  });
});
