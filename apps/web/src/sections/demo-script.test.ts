import { describe, expect, it } from "vitest";
import { answered, type DemoLine } from "./demo-script";

const card = { head: "Confirm buy", action: "Buy CAKE", lines: [], done: "Done" };

describe("answered", () => {
  it("closes the card, drops the wait and adds the result", () => {
    const lines: readonly DemoLine[] = [
      { kind: "me", text: "Buy" },
      { kind: "card", card, answered: false },
      { kind: "waiting" },
    ];
    const after = answered(lines, { kind: "result", tone: "ok", body: "Done" });
    expect(after.map((line) => line.kind)).toEqual(["me", "card", "result"]);
    expect(after[1]).toEqual({ kind: "card", card, answered: true });
    expect(lines[1]).toEqual({ kind: "card", card, answered: false });
  });
});
