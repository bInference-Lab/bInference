import { accountRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import {
  checkEffects,
  type SimulationMismatch,
  simulationFailureOf,
  simulationMismatches,
} from "./check-effects.js";
import {
  allowed,
  coins,
  effectAccounts,
  effectAssets,
  moved,
  others,
  saleBounds,
  saleSteps,
  step,
  tokens,
} from "./test-effects.js";

const { wallet, router, pair, thief } = effectAccounts;
const sold = { spent: tokens(1_000_000n), received: coins(2_000_000n) };

describe("checkEffects", () => {
  it("passes a sale that spends exactly the input and receives at least the minimum out", () => {
    expect(checkEffects(saleSteps(), saleBounds)).toStrictEqual({ ok: true, value: sold });
  });

  it("passes a buy of the token with the coin, which sets no allowance", () => {
    const steps = [step([moved(wallet, router, coins(5n)), moved(pair, wallet, tokens(9n))])];
    const bounds = { ...saleBounds, amountIn: coins(5n), minOut: tokens(9n), approvals: [] };
    expect(checkEffects(steps, bounds)).toStrictEqual({
      ok: true,
      value: { spent: coins(5n), received: tokens(9n) },
    });
  });

  it("reports what arrives above the minimum out, and ignores moves between other accounts", () => {
    const extra = [
      moved(wallet, wallet, others(4n)),
      moved(pair, thief, others(4n)),
      moved(router, wallet, coins(5n)),
    ];
    expect(checkEffects(saleSteps(extra), saleBounds)).toStrictEqual({
      ok: true,
      value: { ...sold, received: coins(2_000_005n) },
    });
  });

  it("compares accounts as the chain's family writes them", () => {
    const shouted = { ...saleBounds, wallet: accountRefSchema.parse("fake:1:0x0000000C") };
    expect(checkEffects(saleSteps(), shouted)).toStrictEqual({ ok: true, value: sold });
  });

  it("names the input spent, not the input the steps moved through the wallet", () => {
    const relayed = [moved(pair, wallet, tokens(3n)), moved(wallet, router, tokens(3n))];
    expect(checkEffects(saleSteps(relayed), saleBounds)).toStrictEqual({ ok: true, value: sold });
  });

  const refusals: readonly (readonly [
    string,
    readonly ReturnType<typeof step>[],
    SimulationMismatch,
  ])[] = [
    ["a step that reverts", [...saleSteps(), { ...step([]), status: "reverted" }], "reverted"],
    [
      "a hidden transfer of the output",
      saleSteps([moved(wallet, thief, coins(1n))]),
      "other_outflow",
    ],
    [
      "a hidden transfer of another token",
      saleSteps([moved(wallet, thief, others(1n))]),
      "other_outflow",
    ],
    [
      "another token leaving and coming back",
      saleSteps([moved(wallet, pair, others(1n)), moved(pair, wallet, others(1n))]),
      "other_outflow",
    ],
    [
      "a hidden transfer of the input",
      saleSteps([moved(wallet, thief, tokens(1n))]),
      "other_amount",
    ],
    [
      "less input spent than the intent",
      saleSteps([moved(pair, wallet, tokens(1n))]),
      "other_amount",
    ],
    ["no steps at all", [], "other_amount"],
    ["another token arriving", saleSteps([moved(pair, wallet, others(1n))]), "other_asset"],
    [
      "an allowance for another spender",
      [...saleSteps(), step([], [allowed(thief, tokens(1n))])],
      "other_approval",
    ],
    [
      "an allowance on another token",
      [...saleSteps(), step([], [allowed(router, others(1n))])],
      "other_approval",
    ],
    [
      "an allowance above what the plan grants",
      [...saleSteps(), step([], [allowed(router, tokens(1_000_001n))])],
      "other_approval",
    ],
  ];

  it.each(refusals)("refuses %s", (_name, steps, mismatch) => {
    expect(checkEffects(steps, saleBounds)).toStrictEqual({ ok: false, error: mismatch });
  });

  it("refuses an allowance above the input, though the plan's approval step grants it", () => {
    const wide = [{ asset: effectAssets.token, spender: router, amountBase: 2_000_000n }];
    const steps = [step([], [allowed(router, tokens(2_000_000n))]), ...saleSteps().slice(1)];
    expect(checkEffects(steps, { ...saleBounds, approvals: wide })).toStrictEqual({
      ok: false,
      error: "other_approval",
    });
  });

  it("refuses output that goes to another account than the wallet", () => {
    const elsewhere = [
      step([], [allowed(router, tokens(1_000_000n))]),
      step(
        [moved(wallet, pair, tokens(1_000_000n)), moved(router, thief, coins(2_000_000n))],
        [allowed(router, tokens(0n))],
      ),
    ];
    expect(checkEffects(elsewhere, saleBounds)).toStrictEqual({ ok: false, error: "low_out" });
  });

  it("refuses steps that spend the input and return nothing", () => {
    const lost = [step([moved(wallet, pair, tokens(1_000_000n))])];
    expect(checkEffects(lost, { ...saleBounds, approvals: [] })).toStrictEqual({
      ok: false,
      error: "low_out",
    });
  });

  it("refuses output below the minimum", () => {
    const short = [
      step([moved(wallet, pair, tokens(1_000_000n)), moved(router, wallet, coins(1_989_999n))]),
    ];
    expect(checkEffects(short, { ...saleBounds, approvals: [] })).toStrictEqual({
      ok: false,
      error: "low_out",
    });
  });

  it("refuses an allowance the trade spends when the plan grants none", () => {
    const spent = [
      step(
        [moved(wallet, pair, tokens(1_000_000n)), moved(router, wallet, coins(2_000_000n))],
        [allowed(router, tokens(0n))],
      ),
    ];
    expect(checkEffects(spent, { ...saleBounds, approvals: [] })).toStrictEqual({
      ok: false,
      error: "other_approval",
    });
  });

  it("names a hidden outflow before the allowance the hidden pull spends", () => {
    const pulled = [
      ...saleSteps(),
      step([moved(wallet, thief, others(1n))], [allowed(thief, others(0n))]),
    ];
    expect(checkEffects(pulled, saleBounds)).toStrictEqual({ ok: false, error: "other_outflow" });
  });

  it("ignores allowances that other accounts set", () => {
    const routerAllows = { owner: router, spender: pair, amount: tokens(9n) };
    expect(checkEffects([...saleSteps(), step([], [routerAllows])], saleBounds)).toStrictEqual({
      ok: true,
      value: sold,
    });
  });

  it("stores a step that reverts as a reverted simulation", () => {
    expect(simulationFailureOf("reverted")).toBe("simulation_reverted");
  });

  it.each(simulationMismatches.filter((mismatch) => mismatch !== "reverted"))(
    "stores %s as effects that differ",
    (mismatch) => {
      expect(simulationFailureOf(mismatch)).toBe("effects_differ");
    },
  );
});
