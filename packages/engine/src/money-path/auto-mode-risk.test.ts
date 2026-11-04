import { assetRefSchema } from "@binference/chain";
import { bpsSchema } from "@binference/core";
import type { IntentRequest, IntentView, RiskView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { testNowMs, testSwap } from "../intents/test-intents.js";
import {
  startTestEngine,
  type TestEngine,
  testCall,
  testCallers,
} from "../operations/test-engine.js";
import type { RiskCheck } from "../ports.js";
import { testCardText } from "./test-launches.js";

// Decision 0363: in auto mode, a trade whose token has a risk warning opens its card.

const unlisted = assetRefSchema.parse("fake:1/token:0x0000000f");
const clean: RiskView = { verdict: "pass", flags: [], onCurve: false, checkedAt: testNowMs };
const taxed: RiskView = { ...clean, verdict: "warn", buyTaxBps: bpsSchema.parse(300) };

// A risk check that passes every token with one view, as GoPlus and the round trip would.
function passingRisk(view: RiskView): RiskCheck {
  return { assess: async () => Promise.resolve({ view }) };
}

async function autoEngine(view: RiskView): Promise<TestEngine> {
  return startTestEngine({ agent: { approvalMode: "auto" }, risk: passingRisk(view) });
}

async function propose(test: TestEngine, request: IntentRequest): Promise<IntentView> {
  const proposed = await test.engine.handlers["intent/propose"](
    testCall(request, testCallers.runtime),
  );
  if (!proposed.ok) {
    throw new Error(`Expected an intent, got ${proposed.error}.`);
  }
  return proposed.value;
}

describe("auto mode and the bought token's risk warnings", () => {
  it("opens the card of a token binference has not verified, with its warning and why", async () => {
    const test = await autoEngine(clean);
    const view = await propose(test, testSwap({ to: unlisted }));

    expect(view.state).toBe("awaiting_confirmation");
    const english = await testCardText(test, view, "en");
    expect(english).toContain("⚠️ Not a verified token: risk checks passed, but check the address");
    expect(english).toContain(
      "Auto mode asks you here: it buys a token that is not verified or has a risk warning",
    );
  });

  it("opens the card of a verified token with a measured tax", async () => {
    const test = await autoEngine(taxed);
    const view = await propose(test, testSwap());

    expect(view.state).toBe("awaiting_confirmation");
    expect(await testCardText(test, view, "en")).toContain(
      "⚠️ This token takes 3.00% tax on every trade",
    );
  });

  it("still runs a trade of a verified token with no warning on its own", async () => {
    const view = await propose(await autoEngine(clean), testSwap());

    expect([view.state, view.card]).toStrictEqual(["paper_filled", undefined]);
  });
});
